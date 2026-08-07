import { describe, expect, test } from "bun:test";
import {
  controlServicesFromStack,
  createDevControlDispatcher,
  formatDevControlsHelp,
  formatDevControlsHint,
  formatDevControlsServiceList,
  parseDevControlKey,
} from "./dev-controls.ts";

describe("dev-controls", () => {
  test("parseDevControlKey maps raw keys", () => {
    expect(parseDevControlKey("q")).toBe("q");
    expect(parseDevControlKey("\u0003")).toBe("q");
    expect(parseDevControlKey("?")).toBe("?");
    expect(parseDevControlKey("h")).toBe("?");
    expect(parseDevControlKey("c")).toBe("c");
    expect(parseDevControlKey("l")).toBe("l");
    expect(parseDevControlKey("u")).toBe("u");
    expect(parseDevControlKey("x")).toBe("x");
    expect(parseDevControlKey("r")).toBe("r");
    expect(parseDevControlKey("3")).toBe("3");
    expect(parseDevControlKey("\u001b")).toBe("esc");
    expect(parseDevControlKey("z")).toBeNull();
  });

  test("format hint and help are scannable", () => {
    expect(formatDevControlsHint(false)).toContain("keys");
    expect(formatDevControlsHint(false)).toContain("refresh");
    expect(formatDevControlsHint(false)).toContain("quit");
    expect(formatDevControlsHelp(false)).toContain("select service");
    expect(formatDevControlsHelp(false)).toContain("refresh");
    expect(formatDevControlsHelp(false)).not.toMatch(/\u001b\[/);
  });

  test("controlServicesFromStack dedupes by serviceName", () => {
    const list = controlServicesFromStack([
      { label: "ai", serviceName: "ai" },
      { label: "mail", serviceName: "channel-email" },
      { label: "mail-ui", serviceName: "channel-email" },
      { label: "postgres", serviceName: "store-sql" },
    ]);
    expect(list.map((s) => s.serviceName)).toEqual(["ai", "channel-email", "store-sql"]);
  });

  test("formatDevControlsServiceList numbers rows", () => {
    const out = formatDevControlsServiceList(
      [
        { label: "ai", serviceName: "ai" },
        { label: "postgres", serviceName: "store-sql" },
      ],
      (name) => (name === "ai" ? "error" : "ready"),
      false,
      1,
    );
    expect(out).toContain("1");
    expect(out).toContain("ai");
    expect(out).toContain("postgres");
    expect(out).toContain(">");
  });

  test("dispatcher select → stop → up stack → quit", async () => {
    const calls: string[] = [];
    let quit = false;
    let settled = 0;
    let refreshed = 0;
    let panels = 0;
    const d = createDevControlDispatcher({
      write: () => {},
      onQuit: () => {
        quit = true;
      },
      onRefresh: () => {
        refreshed += 1;
      },
      onShowPanel: () => {
        panels += 1;
      },
      onComposeSettled: () => {
        settled += 1;
      },
      services: () => [
        { label: "ai", serviceName: "ai" },
        { label: "postgres", serviceName: "store-sql" },
      ],
      composeAction: async (action, names) => {
        calls.push(`${action}:${names.join(",") || "*"}`);
      },
    });
    d.handleKey("l");
    await Bun.sleep(10);
    d.handleKey("1");
    d.handleKey("x");
    await Bun.sleep(10);
    d.handleKey("u");
    await Bun.sleep(10);
    d.handleKey("c");
    await Bun.sleep(10);
    d.handleKey("q");
    expect(calls).toEqual(["stop:ai", "up:*"]);
    expect(settled).toBe(2);
    expect(refreshed).toBe(1);
    expect(panels).toBe(1);
    expect(quit).toBe(true);
    d.stop();
  });
});
