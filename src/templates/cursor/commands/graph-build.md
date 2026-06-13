# graph-build

Build the ContextGraph (AST knowledge graph) for the current project.

Call `codegraph_build` with the current working directory as the path (or a path provided by the user).

After the build completes, report total nodes, edges, and communities. Once built, use `codegraph_query` to answer structural questions about the codebase instead of reading files directly.
