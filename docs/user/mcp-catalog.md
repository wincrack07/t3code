# MCP servers

Open **Settings → MCP servers** for the environment that should run them. A server added there is shared: every agent on that machine can use its tools, on any Claude or Codex account, any other provider, and in subagents, without adding it to each CLI.

Choose **Add MCP server** and give it either a **Command**, typed as you would in a terminal (for example `npx -y @modelcontextprotocol/server-github`), or a streamable HTTP **URL**. Mark tokens and keys as **Secret**: their values stay on that machine and are shown afterwards only as **Saved**. Leave a saved secret blank to keep it.

**Import** reads the MCP servers already configured in Claude Code, the Claude app, Codex and Cursor on that machine, including the folders of your other Claude and Codex accounts, and copies the ones you pick. The CLI configs are left as they were.

Agents reach the catalog through two T3 Code tools: `mcp_tools` finds a server's tools and `mcp_call` runs one. A tool the server marks read-only works from any thread. Any other tool needs a full-access thread, because T3 Code approves its own tools for the agent.

T3 Code starts a server the first time it is needed and keeps one connection for every agent. A server that cannot start shows why; fix it and choose **Retry**. Turning a server off takes its tools away from agents until you turn it on again.

Servers that sign in through a browser (OAuth) are not supported yet. Use a token in a header or an environment variable instead.
