import {
  projectLabel,
  projectPathLabel,
} from "../lib/project";

export function ProjectPicker({
  projects,
  activeProject,
  onChange,
  disabled = false,
}) {
  const discovered = projects.data;
  const options =
    activeProject &&
    !discovered.some((project) => project.id === activeProject.id)
      ? [activeProject, ...discovered]
      : discovered;
  const loading = projects.status === "loading";
  const unavailable =
    projects.status === "error" && discovered.length === 0;

  return (
    <div className="project-picker">
      <label>
        <span className="section-label">PROJECT</span>
        <select
          value={activeProject?.id ?? ""}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled || loading || options.length < 2}
          aria-label="Active project"
        >
          {options.length === 0 ? (
            <option value="">
              {loading ? "Loading projects…" : "No projects available"}
            </option>
          ) : null}
          {options.map((project) => (
            <option key={project.id} value={project.id}>
              {projectLabel(project)}
            </option>
          ))}
        </select>
      </label>
      <small title={activeProject ? projectPathLabel(activeProject) : undefined}>
        {activeProject
          ? projectPathLabel(activeProject)
          : unavailable
            ? projects.error || "Projects unavailable"
            : "Discovering projects…"}
      </small>
    </div>
  );
}
