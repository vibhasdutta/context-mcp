Call `codegraph_build` with the path `$ARGUMENTS` (if no argument given, use the current working directory).

This builds the ContextGraph for the project — parses all source files into an AST knowledge graph using tree-sitter. Takes a few seconds. Once built, use `codegraph_query` to answer any structural question about the codebase instead of reading files directly.

After build completes, report: total nodes, edges, and communities found.
