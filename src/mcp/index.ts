/**
 * MCP AI surfaces (console §10.3 · unified-theory §25):
 * - App MCP `:6535` — Manifest, schemas, effects, traces, Console-safe actions
 * - Docs MCP `:6536` — read-only documentation search / fetch
 *
 * Subpath: `okengine/mcp`
 * @module
 */

export {
  asData,
  freezeData,
  isDataEnvelope,
  MCP_DATA_KIND,
  type McpDataEnvelope,
  type McpDataProvenance,
} from "./data.ts";

export {
  authorizeToolCall,
  checkParams,
  expandOperatorScopes,
  MCP_POLICY_BY_NAME,
  MCP_TOOL_POLICIES,
  type AuthzDecision,
  type McpMutability,
  type McpParamPolicy,
  type McpToolPolicy,
} from "./authorization.ts";

export {
  createConfirmationGate,
  digestArgs,
  MCP_CONFIRM_PHRASE,
  type ConfirmConsumeResult,
  type ConfirmationGateOptions,
  type PendingConfirmation,
} from "./confirmation.ts";

export {
  authenticateMcpRequest,
  extractBearer,
  FOREIGN_AUDIENCES,
  mintMcpSession,
  MCP_AUDIENCE,
  newMcpTransportSessionId,
  type MintMcpSessionOptions,
  type McpRequester,
} from "./session.ts";

export {
  MCP_PROTOCOL_VERSION,
  parseJsonRpcRequest,
  parseToolsCallParams,
  rpcError,
  rpcSuccess,
  RpcErrorCode,
  type JsonRpcError,
  type JsonRpcId,
  type JsonRpcRequest,
  type JsonRpcSuccess,
  type McpInitializeResult,
} from "./protocol.ts";

export {
  createToolRuntime,
  projectRun,
  type McpContext,
  type ToolCallResult,
} from "./tools.ts";

export {
  createMcpServer,
  serveMcp,
  type CreateMcpServerOptions,
  type McpServer,
  type McpServerHandle,
  type ServeMcpOptions,
} from "./server.ts";

export {
  defaultDocsContentDir,
  loadDocsIndex,
  parseDocsFrontmatter,
  stripYamlFrontmatter,
  type DocsIndex,
  type DocsPage,
  type DocsSearchHit,
} from "./docs-index.ts";

export {
  createDocsToolRuntime,
  DOCS_MCP_TOOLS,
  type DocsToolCallResult,
  type DocsToolDescriptor,
} from "./docs-tools.ts";

export {
  createDocsMcpServer,
  serveDocsMcp,
  type CreateDocsMcpServerOptions,
  type DocsMcpServer,
  type DocsMcpServerHandle,
  type ServeDocsMcpOptions,
} from "./docs-server.ts";
