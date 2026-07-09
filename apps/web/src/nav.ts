// The one navigation primitive the SPA screens share: push a new query string. Kept in its own
// module so screen components can depend on the type without importing App (which imports them),
// keeping the dependency graph acyclic (the boundary lint forbids cycles).
export type Navigate = (search: string) => void;
