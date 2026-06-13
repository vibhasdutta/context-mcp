# graph-build

Build the ContextGraph (AST knowledge graph) for the current project.

1. Call `codegraph_build` with the current working directory as the path (or a path provided by the user).

2. Wait for the build to complete.

3. Report total nodes, edges, and communities found.

4. Once built, use `codegraph_query` to answer structural questions about the codebase instead of reading files directly.
