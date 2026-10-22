package com.opencode.mobile;

import android.util.JsonReader;

import java.io.BufferedInputStream;
import java.io.BufferedReader;
import java.io.Closeable;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

final class SessionImport {
    static final long MAX_FILE_BYTES = 64L * 1024L * 1024L;
    static final int MAX_MESSAGES = 200_000;
    static final int MAX_PARTS = 2_000_000;
    private static final int MAX_ID_LENGTH = 200;

    static final class Summary {
        final String sessionID;
        final int messages;
        final int parts;

        Summary(String sessionID, int messages, int parts) {
            this.sessionID = sessionID;
            this.messages = messages;
            this.parts = parts;
        }
    }

    private SessionImport() {}

    static Summary inspect(File file) throws IOException {
        if (file == null || !file.isFile()) {
            throw new IOException("The selected session file could not be read.");
        }
        if (file.length() > MAX_FILE_BYTES) {
            throw new IOException(
                "The session file is too large to import safely. The limit is 64 MB."
            );
        }

        JsonReader reader = null;
        try {
            reader = new JsonReader(new BufferedReader(
                new InputStreamReader(
                    new BufferedInputStream(new FileInputStream(file)),
                    StandardCharsets.UTF_8
                )
            ));
            reader.setLenient(false);

            String sessionID = null;
            int messages = 0;
            int parts = 0;
            boolean sawInfo = false;
            boolean sawMessages = false;

            reader.beginObject();
            while (reader.hasNext()) {
                String field = reader.nextName();
                if ("info".equals(field)) {
                    sawInfo = true;
                    reader.beginObject();
                    while (reader.hasNext()) {
                        String infoField = reader.nextName();
                        if ("id".equals(infoField)) {
                            sessionID = reader.nextString();
                        } else {
                            reader.skipValue();
                        }
                    }
                    reader.endObject();
                } else if ("messages".equals(field)) {
                    sawMessages = true;
                    reader.beginArray();
                    while (reader.hasNext()) {
                        messages++;
                        if (messages > MAX_MESSAGES) {
                            throw new IOException("The session contains too many messages.");
                        }
                        parts += readMessage(reader);
                        if (parts > MAX_PARTS) {
                            throw new IOException("The session contains too many parts.");
                        }
                    }
                    reader.endArray();
                } else {
                    reader.skipValue();
                }
            }
            reader.endObject();

            if (!sawInfo || sessionID == null || !validSessionID(sessionID)) {
                throw new IOException("The file is not a valid OpenCode session export.");
            }
            if (!sawMessages) {
                throw new IOException("The session export has no messages array.");
            }
            return new Summary(sessionID, messages, parts);
        } catch (IOException failure) {
            if (failure.getMessage() != null
                && failure.getMessage().startsWith("The session")) {
                throw failure;
            }
            throw new IOException(
                "The file is not a valid OpenCode session export: " + safeMessage(failure),
                failure
            );
        } catch (RuntimeException failure) {
            throw new IOException(
                "The file is not a valid OpenCode session export: " + safeMessage(failure),
                failure
            );
        } finally {
            closeQuietly(reader);
        }
    }

    static Summary countServerMessages(InputStream input) throws IOException {
        if (input == null) {
            throw new IOException("The local server returned no session data.");
        }
        JsonReader reader = null;
        try {
            reader = new JsonReader(new BufferedReader(
                new InputStreamReader(input, StandardCharsets.UTF_8)
            ));
            reader.setLenient(false);
            int messages = 0;
            int parts = 0;
            reader.beginArray();
            while (reader.hasNext()) {
                messages++;
                if (messages > MAX_MESSAGES) {
                    throw new IOException("The local server returned too many messages.");
                }
                parts += readMessage(reader);
                if (parts > MAX_PARTS) {
                    throw new IOException("The local server returned too many parts.");
                }
            }
            reader.endArray();
            return new Summary("", messages, parts);
        } catch (RuntimeException failure) {
            throw new IOException("The local server returned an invalid session.", failure);
        } finally {
            closeQuietly(reader);
        }
    }

    private static int readMessage(JsonReader reader) throws IOException {
        int parts = 0;
        boolean sawInfo = false;
        reader.beginObject();
        while (reader.hasNext()) {
            String field = reader.nextName();
            if ("info".equals(field)) {
                sawInfo = true;
                readMessageInfo(reader);
            } else if ("parts".equals(field)) {
                reader.beginArray();
                while (reader.hasNext()) {
                    parts++;
                    reader.skipValue();
                }
                reader.endArray();
            } else {
                reader.skipValue();
            }
        }
        reader.endObject();
        if (!sawInfo) {
            throw new IOException("A message is missing its info object.");
        }
        return parts;
    }

    private static void readMessageInfo(JsonReader reader) throws IOException {
        reader.beginObject();
        while (reader.hasNext()) {
            String field = reader.nextName();
            if ("id".equals(field)) {
                String id = reader.nextString();
                if (id == null || id.length() > MAX_ID_LENGTH) {
                    throw new IOException("A message has an invalid identifier.");
                }
            } else {
                reader.skipValue();
            }
        }
        reader.endObject();
    }

    private static boolean validSessionID(String id) {
        if (id == null || id.length() > MAX_ID_LENGTH || !id.startsWith("ses_")) {
            return false;
        }
        for (int index = 0; index < id.length(); index++) {
            char character = id.charAt(index);
            boolean valid = (character >= 'a' && character <= 'z')
                || (character >= 'A' && character <= 'Z')
                || (character >= '0' && character <= '9')
                || character == '_'
                || character == '-';
            if (!valid) return false;
        }
        return id.length() > 4;
    }

    private static String safeMessage(Throwable failure) {
        String message = failure.getMessage();
        return message == null || message.trim().isEmpty()
            ? "unreadable JSON"
            : message.trim();
    }

    private static void closeQuietly(Closeable closeable) {
        if (closeable == null) return;
        try {
            closeable.close();
        } catch (IOException ignored) {
        }
    }
}
