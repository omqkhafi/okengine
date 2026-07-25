/**
 * MCP AI surface on port 6535 (console §10.3 · unified-theory §25).
 *
 * Exposes the Manifest, schemas, effects, traces, and Console-safe runtime
 * actions to agents — read-only by default, write tools gated by fresh
 * human confirmation, every return wrapped as inert data.
 *
 * Subpath: `okengine/mcp`
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
