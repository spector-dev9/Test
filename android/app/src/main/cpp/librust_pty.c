#define _GNU_SOURCE
#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <pty.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <termios.h>
#include <unistd.h>

#define MAX_PTYS 32
#define SUCCESS 0
#define ERROR -1
#define CHILD_EXITED -2

/* Bun on Android runs against musl. Bionic's compiler support references
 * two symbols that musl does not export; provide compatible shims. */
extern int *__errno_location(void);
int *__errno(void) { return __errno_location(); }
int __register_atfork(void *prepare, void *parent, void *child, void *dso) {
  (void)prepare; (void)parent; (void)child; (void)dso;
  return 0;
}

struct pty_entry {
  int used;
  int master;
  pid_t pid;
  int exited;
  int exit_code;
};

static struct pty_entry entries[MAX_PTYS];

static struct pty_entry *find_entry(int handle) {
  if (handle <= 0) return NULL;
  for (int i = 0; i < MAX_PTYS; i++) {
    if (entries[i].used && entries[i].master >= 0 &&
        (i + 1) == handle) return &entries[i];
  }
  return NULL;
}

static int wait_for_child(struct pty_entry *entry, int block) {
  if (!entry || entry->exited) return entry ? entry->exited : 0;
  int status = 0;
  pid_t result = waitpid(entry->pid, &status, block ? 0 : WNOHANG);
  if (result == entry->pid) {
    entry->exited = 1;
    if (WIFEXITED(status)) entry->exit_code = WEXITSTATUS(status);
    else if (WIFSIGNALED(status)) entry->exit_code = 128 + WTERMSIG(status);
    else entry->exit_code = -1;
  }
  return entry->exited;
}

static void reap_nonblocking(struct pty_entry *entry) {
  if (entry && !entry->exited) wait_for_child(entry, 0);
}

static char *skip_space(char *cursor) {
  while (*cursor && isspace((unsigned char)*cursor)) cursor++;
  return cursor;
}

static int split_cmdline(const char *input, char ***out_argv) {
  size_t capacity = 8, count = 0;
  char **argv = calloc(capacity, sizeof(char *));
  if (!argv) return ERROR;
  const char *cursor = input;

  while (*cursor) {
    cursor = skip_space((char *)cursor);
    if (!*cursor) break;
    size_t buffer_len = 64, used = 0;
    char *word = malloc(buffer_len);
    if (!word) goto fail;
    int quote = 0;

    while (*cursor) {
      char ch = *cursor;
      if (quote == 0) {
        if (isspace((unsigned char)ch)) break;
        if (ch == '\'' || ch == '"') { quote = ch; cursor++; continue; }
        if (ch == '\\' && cursor[1]) { cursor++; ch = *cursor; }
      } else if (quote == '\'') {
        if (ch == '\'') { quote = 0; cursor++; continue; }
      } else {
        if (ch == '"') { quote = 0; cursor++; continue; }
        if (ch == '\\' && (cursor[1] == '"' || cursor[1] == '\\' || cursor[1] == '$' || cursor[1] == '`')) {
          cursor++; ch = *cursor;
        }
      }
      if (used + 2 > buffer_len) {
        buffer_len *= 2;
        char *grown = realloc(word, buffer_len);
        if (!grown) { free(word); goto fail; }
        word = grown;
      }
      word[used++] = ch;
      cursor++;
    }

    word[used] = '\0';
    if (count + 2 > capacity) {
      capacity *= 2;
      char **grown = realloc(argv, capacity * sizeof(char *));
      if (!grown) { free(word); goto fail; }
      argv = grown;
    }
    argv[count++] = word;
  }

  argv[count] = NULL;
  if (count == 0) goto fail;
  *out_argv = argv;
  return (int)count;

fail:
  for (size_t i = 0; i < count; i++) free(argv[i]);
  free(argv);
  return ERROR;
}

static int parse_env(const char *env, char ***out_env, int *out_count) {
  int count = 0;
  if (!env) { *out_env = NULL; *out_count = 0; return SUCCESS; }
  const char *cursor = env;
  while (*cursor) {
    size_t len = strlen(cursor);
    if (len == 0) break;
    count++;
    cursor += len + 1;
  }
  char **values = calloc((size_t)count + 1, sizeof(char *));
  if (!values) return ERROR;
  cursor = env;
  for (int i = 0; i < count; i++) {
    size_t len = strlen(cursor);
    values[i] = strndup(cursor, len);
    if (!values[i]) {
      for (int j = 0; j < i; j++) free(values[j]);
      free(values);
      return ERROR;
    }
    cursor += len + 1;
  }
  values[count] = NULL;
  *out_env = values;
  *out_count = count;
  return SUCCESS;
}

static void free_env(char **values, int count) {
  if (!values) return;
  for (int i = 0; i < count; i++) free(values[i]);
  free(values);
}

int bun_pty_spawn(const char *cmdline, const char *cwd, const char *env, int cols, int rows) {
  if (!cmdline || !cwd || cols <= 0 || rows <= 0) return ERROR;

  char **argv = NULL;
  char **env_values = NULL;
  int env_count = 0;
  int master = -1, slave = -1;
  if (split_cmdline(cmdline, &argv) <= 0) return ERROR;
  if (parse_env(env, &env_values, &env_count) != SUCCESS) {
    for (int i = 0; argv[i]; i++) free(argv[i]);
    free(argv);
    return ERROR;
  }

  struct winsize size = { .ws_row = (unsigned short)rows, .ws_col = (unsigned short)cols, .ws_xpixel = 0, .ws_ypixel = 0 };
  if (openpty(&master, &slave, NULL, NULL, &size) != 0) goto fail;

  pid_t pid = fork();
  if (pid < 0) goto fail;

  if (pid == 0) {
    setsid();
    ioctl(slave, TIOCSCTTY, 0);
    dup2(slave, STDIN_FILENO);
    dup2(slave, STDOUT_FILENO);
    dup2(slave, STDERR_FILENO);
    if (slave > STDERR_FILENO) close(slave);
    if (master >= 0) close(master);
    if (chdir(cwd) != 0) _exit(126);
    for (int i = 0; i < env_count; i++) {
      char *value = env_values[i];
      char *equals = strchr(value, '=');
      if (!equals) continue;
      *equals = '\0';
      setenv(value, equals + 1, 1);
      *equals = '=';
    }
    if (!getenv("TERM")) setenv("TERM", "xterm-256color", 1);
    execvp(argv[0], argv);
    _exit(127);
  }

  close(slave);
  slave = -1;
  int flags = fcntl(master, F_GETFL, 0);
  if (flags >= 0) fcntl(master, F_SETFL, flags | O_NONBLOCK);

  int slot = -1;
  for (int i = 0; i < MAX_PTYS; i++) {
    if (!entries[i].used) { slot = i; break; }
  }
  if (slot < 0) {
    kill(pid, SIGKILL);
    wait_for_child(&(struct pty_entry){ .pid = pid }, 1);
    goto fail;
  }

  entries[slot].used = 1;
  entries[slot].master = master;
  entries[slot].pid = pid;
  entries[slot].exited = 0;
  entries[slot].exit_code = -1;
  int actual_handle = slot + 1;

  for (int i = 0; argv[i]; i++) free(argv[i]);
  free(argv);
  free_env(env_values, env_count);
  return actual_handle;

fail:
  if (slave >= 0) close(slave);
  if (master >= 0) close(master);
  for (int i = 0; argv && argv[i]; i++) free(argv[i]);
  free(argv);
  free_env(env_values, env_count);
  return ERROR;
}

int bun_pty_write(int handle, const void *data, int len) {
  struct pty_entry *entry = find_entry(handle);
  if (!entry || !data || len < 0) return ERROR;
  reap_nonblocking(entry);
  if (entry->exited) return CHILD_EXITED;
  const unsigned char *cursor = data;
  int remaining = len;
  while (remaining > 0) {
    ssize_t written = write(entry->master, cursor, (size_t)remaining);
    if (written > 0) { cursor += written; remaining -= (int)written; continue; }
    if (written < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
      struct pollfd pfd = { .fd = entry->master, .events = POLLOUT, .revents = 0 };
      poll(&pfd, 1, 10);
      continue;
    }
    if (written < 0 && errno == EINTR) continue;
    return ERROR;
  }
  return SUCCESS;
}

int bun_pty_read(int handle, void *buffer, int len) {
  struct pty_entry *entry = find_entry(handle);
  if (!entry || !buffer || len <= 0) return ERROR;

  struct pollfd pfd = { .fd = entry->master, .events = POLLIN, .revents = 0 };
  int ready = poll(&pfd, 1, 0);

  if (ready > 0) {
    ssize_t count = read(entry->master, buffer, (size_t)len);
    if (count > 0) return (int)count;
    if (count == 0 || (count < 0 && errno == EIO)) {
      wait_for_child(entry, 1);
      entry->exited = 1;
      return CHILD_EXITED;
    }
    if (count < 0 && errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR) {
      return ERROR;
    }
  }

  reap_nonblocking(entry);
  if (entry->exited) return CHILD_EXITED;
  return 0;
}

int bun_pty_resize(int handle, int cols, int rows) {
  struct pty_entry *entry = find_entry(handle);
  if (!entry || cols <= 0 || rows <= 0) return ERROR;
  struct winsize size = { .ws_row = (unsigned short)rows, .ws_col = (unsigned short)cols, .ws_xpixel = 0, .ws_ypixel = 0 };
  if (ioctl(entry->master, TIOCSWINSZ, &size) != 0) return ERROR;
  if (entry->pid > 0) kill(entry->pid, SIGWINCH);
  return SUCCESS;
}

int bun_pty_kill(int handle) {
  struct pty_entry *entry = find_entry(handle);
  if (!entry) return ERROR;
  if (!entry->exited) {
    kill(entry->pid, SIGHUP);
    kill(entry->pid, SIGTERM);
    wait_for_child(entry, 1);
  }
  return SUCCESS;
}

int bun_pty_get_pid(int handle) {
  struct pty_entry *entry = find_entry(handle);
  return entry ? (int)entry->pid : ERROR;
}

int bun_pty_get_exit_code(int handle) {
  struct pty_entry *entry = find_entry(handle);
  return entry ? entry->exit_code : ERROR;
}

void bun_pty_close(int handle) {
  struct pty_entry *entry = find_entry(handle);
  if (!entry) return;
  if (!entry->exited) {
    kill(entry->pid, SIGHUP);
    kill(entry->pid, SIGTERM);
    wait_for_child(entry, 0);
  }
  if (entry->master >= 0) close(entry->master);
  memset(entry, 0, sizeof(*entry));
  entry->master = -1;
}
