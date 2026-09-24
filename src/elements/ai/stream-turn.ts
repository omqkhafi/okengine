/**
 * One model turn for an agent: stream deltas when the driver can, otherwise
 * one `complete()` result. The caller journals the assembled result.
 */

import type {
  AiCompleteOptions,
  AiCompleteResult,
  AiModelClient,
  AiStreamChunk,
  AiToolCall,
} from "../../drivers/ai-types.ts";
import type { AgentEventEmit } from "./events.ts";

/** A model turn plus whether live deltas were already emitted. */
export interface ModelTurn {
  readonly result: AiCompleteResult;
  /** True when text and tool-call events were emitted from stream chunks. */
  readonly streamed: boolean;
}

interface ToolAcc {
  id: string;
  name: string;
  args: string;
  started: boolean;
  ended: boolean;
  buffered: string;
}

/**
 * Run one model turn. Streams when `emit` is set and the client implements
 * `stream`. Otherwise returns `complete()` and leaves events to the caller.
 *
 * @param client - Opened model client
 * @param options - Completion options, including tools
 * @param emit - Live AG-UI sink. Absent means do not stream.
 * @param nextMessageId - Allocates `m-N` ids for emitted text
 */
export async function readModelTurn(
  client: AiModelClient,
  options: AiCompleteOptions,
  emit: AgentEventEmit | undefined,
  nextMessageId: () => string,
): Promise<ModelTurn> {
  if (emit && client.stream) {
    const result = await consumeStream(client, options, emit, nextMessageId);
    return { result, streamed: true };
  }
  const result = await client.complete(options);
  return { result, streamed: false };
}

async function consumeStream(
  client: AiModelClient,
  options: AiCompleteOptions,
  emit: AgentEventEmit,
  nextMessageId: () => string,
): Promise<AiCompleteResult> {
  const stream = client.stream;
  if (!stream) {
    return client.complete(options);
  }
  let text = "";
  let messageId: string | undefined;
  let textOpen = false;
  let emittedText = false;
  const tools = new Map<number, ToolAcc>();
  let usage: AiCompleteResult["usage"];
  const closeText = (): void => {
    if (!textOpen || messageId === undefined) return;
    emit({ type: "TEXT_MESSAGE_END", messageId });
    textOpen = false;
  };
  const endTool = (acc: ToolAcc): void => {
    if (!acc.started || acc.ended) return;
    emit({ type: "TOOL_CALL_END", toolCallId: acc.id });
    acc.ended = true;
  };
  for await (const chunk of stream.call(client, options)) {
    applyChunk(chunk, {
      emit,
      tools,
      closeText,
      endTool,
      onText(delta) {
        if (!textOpen) {
          messageId = nextMessageId();
        emit({ type: "TEXT_MESSAGE_START", messageId, role: "assistant" });
        textOpen = true;
        emittedText = true;
        }
        text += delta;
        emit({ type: "TEXT_MESSAGE_CONTENT", messageId: messageId!, delta });
      },
      parentMessageId: () => (emittedText ? messageId : undefined),
      onUsage(next) {
        usage = {
          ...(usage?.inputTokens !== undefined || next.inputTokens !== undefined
            ? { inputTokens: next.inputTokens ?? usage?.inputTokens }
            : {}),
          ...(usage?.outputTokens !== undefined || next.outputTokens !== undefined
            ? { outputTokens: next.outputTokens ?? usage?.outputTokens }
            : {}),
          ...(usage?.cost !== undefined || next.cost !== undefined
            ? { cost: next.cost ?? usage?.cost }
            : {}),
        };
      },
    });
  }
  closeText();
  for (const acc of tools.values()) endTool(acc);
  const toolCalls = assembleToolCalls(tools);
  return {
    text,
    model: options.model ?? client.model,
    driverId: client.driverId,
    ...(toolCalls !== undefined ? { toolCalls } : {}),
    ...(usage !== undefined ? { usage } : {}),
  };
}

function applyChunk(
  chunk: AiStreamChunk,
  sink: {
    emit: AgentEventEmit;
    tools: Map<number, ToolAcc>;
    closeText: () => void;
    endTool: (acc: ToolAcc) => void;
    parentMessageId: () => string | undefined;
    onText: (delta: string) => void;
    onUsage: (usage: NonNullable<AiStreamChunk["usage"]>) => void;
  },
): void {
  if (chunk.text) sink.onText(chunk.text);
  const call = chunk.toolCall;
  if (call) {
    sink.closeText();
    let acc = sink.tools.get(call.index);
    if (!acc) {
      acc = {
        id: call.id ?? `call-${call.index}`,
        name: call.name ?? "",
        args: "",
        started: false,
        ended: false,
        buffered: "",
      };
      sink.tools.set(call.index, acc);
    }
    if (call.id) acc.id = call.id;
    if (call.name) acc.name = call.name;
    const delta = call.argumentsDelta ?? "";
    if (!acc.started && acc.name) {
      const parentMessageId = sink.parentMessageId();
      sink.emit({
        type: "TOOL_CALL_START",
        toolCallId: acc.id,
        toolCallName: acc.name,
        ...(parentMessageId !== undefined ? { parentMessageId } : {}),
      });
      acc.started = true;
      if (acc.buffered) {
        sink.emit({ type: "TOOL_CALL_ARGS", toolCallId: acc.id, delta: acc.buffered });
        acc.args += acc.buffered;
        acc.buffered = "";
      }
    }
    if (delta) {
      if (acc.started) {
        acc.args += delta;
        sink.emit({ type: "TOOL_CALL_ARGS", toolCallId: acc.id, delta });
      } else {
        acc.buffered += delta;
      }
    }
  }
  if (chunk.usage) sink.onUsage(chunk.usage);
  if (chunk.done) {
    sink.closeText();
    for (const acc of sink.tools.values()) sink.endTool(acc);
  }
}

function assembleToolCalls(tools: Map<number, ToolAcc>): readonly AiToolCall[] | undefined {
  if (tools.size === 0) return undefined;
  return [...tools.entries()]
    .sort((a, b) => a[0] - b[0])
    .filter(([, acc]) => acc.name.length > 0)
    .map(([, acc]) => ({
      id: acc.id,
      name: acc.name,
      arguments: parseArgs(acc.args || acc.buffered),
    }));
}

function parseArgs(raw: string): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { _raw: raw };
  }
}
