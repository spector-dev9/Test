const STATUS_ICONS = {
  pending: "○",
  in_progress: "◐",
  completed: "✓",
  cancelled: "×",
};

const STATUS_ORDER = {
  in_progress: 0,
  pending: 1,
  completed: 2,
  cancelled: 3,
};

export function todoSummary(todos) {
  const list = Array.isArray(todos) ? todos : [];
  const completed = list.filter(
    (todo) => todo.status === "completed",
  ).length;

  return { total: list.length, completed };
}

export function orderTodos(todos) {
  const list = Array.isArray(todos) ? todos : [];

  return list
    .map((todo, index) => ({ todo, index }))
    .sort((left, right) => {
      const leftRank = STATUS_ORDER[left.todo?.status] ?? 4;
      const rightRank = STATUS_ORDER[right.todo?.status] ?? 4;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return left.index - right.index;
    })
    .map((entry) => entry.todo);
}

export function todoIcon(status) {
  return STATUS_ICONS[status] ?? "○";
}
