import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

interface McpToolInfo {
  name: string;
  description: string;
}

interface McpConfigInfo {
  sse_port: number;
  exe_path: string;
}

interface McpConfigPopupProps {
  onClose: () => void;
  addToast: (msg: string, type?: "success" | "error") => void;
}

export const McpConfigPopup: React.FC<McpConfigPopupProps> = ({ onClose, addToast }) => {
  const [config, setConfig] = useState<McpConfigInfo | null>(null);
  const [tools, setTools] = useState<McpToolInfo[]>([]);
  const [activeTab, setActiveTab] = useState<"sse-claude" | "stdio-claude" | "stdio-gemini" | "generic">("sse-claude");

  useEffect(() => {
    // Load config and tools dynamically from the backend
    const loadMcpDetails = async () => {
      try {
        const configData = await invoke<McpConfigInfo>("get_mcp_config");
        setConfig(configData);
        
        const toolsData = await invoke<McpToolInfo[]>("get_mcp_tools");
        setTools(toolsData);
      } catch (err) {
        console.error("Failed to load MCP config details:", err);
      }
    };
    loadMcpDetails();
  }, []);

  // Listen to Escape key to close popup
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    addToast("Configuration copied to clipboard!", "success");
  };

  const getSseUrl = () => {
    const port = config?.sse_port || 3001;
    return `http://127.0.0.1:${port}/sse`;
  };

  const getClaudeSseConfig = () => {
    return JSON.stringify(
      {
        mcpServers: {
          vibenote: {
            type: "sse",
            url: getSseUrl(),
          },
        },
      },
      null,
      2
    );
  };

  const getClaudeStdioConfig = () => {
    const path = config?.exe_path || "/absolute/path/to/vibenote";
    return JSON.stringify(
      {
        mcpServers: {
          vibenote: {
            command: path,
            args: ["--mcp"],
          },
        },
      },
      null,
      2
    );
  };

  const getGeminiConfig = () => {
    const path = config?.exe_path || "/absolute/path/to/vibenote";
    return JSON.stringify(
      {
        mcpServers: {
          vibenote: {
            command: path,
            args: ["--mcp"],
          },
        },
      },
      null,
      2
    );
  };

  return (
    <div className="workspace-overlay" onClick={onClose}>
      <div className="workspace-modal mcp-config-modal animate-fade-in" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>🔌 Model Context Protocol (MCP) Integration</h3>
          <button className="btn-close" onClick={onClose}>&times;</button>
        </div>

        <div className="modal-body mcp-modal-body">
          <p className="mcp-intro-text">
            vibeNote exposes local vectors and semantic tools directly to your AI assistants (Claude Desktop, Gemini CLI, Cursor, etc.) via the Model Context Protocol. Connect your client using either the background HTTP/SSE service or the direct Stdio runner.
          </p>

          <div className="mcp-connection-row">
            <span className="mcp-row-label">SSE Endpoint URL:</span>
            <div className="mcp-url-box">
              <code>{getSseUrl()}</code>
              <button className="btn btn-secondary btn-small" onClick={() => copyToClipboard(getSseUrl())}>
                Copy Link
              </button>
            </div>
          </div>

          <div className="mcp-config-tabs">
            <button
              className={`mcp-tab-btn ${activeTab === "sse-claude" ? "active" : ""}`}
              onClick={() => setActiveTab("sse-claude")}
            >
              Claude Desktop (SSE)
            </button>
            <button
              className={`mcp-tab-btn ${activeTab === "stdio-claude" ? "active" : ""}`}
              onClick={() => setActiveTab("stdio-claude")}
            >
              Claude Desktop (Stdio)
            </button>
            <button
              className={`mcp-tab-btn ${activeTab === "stdio-gemini" ? "active" : ""}`}
              onClick={() => setActiveTab("stdio-gemini")}
            >
              Gemini CLI (Stdio)
            </button>
            <button
              className={`mcp-tab-btn ${activeTab === "generic" ? "active" : ""}`}
              onClick={() => setActiveTab("generic")}
            >
              Generic SSE Client
            </button>
          </div>

          <div className="mcp-tab-content">
            {activeTab === "sse-claude" && (
              <div className="mcp-preset-box">
                <p className="mcp-preset-desc">
                  To configure Claude Desktop to connect via the background Server-Sent Events service, add the following to your <code>claude_desktop_config.json</code>:
                </p>
                <pre>
                  <code>{getClaudeSseConfig()}</code>
                </pre>
                <button className="btn btn-primary" onClick={() => copyToClipboard(getClaudeSseConfig())}>
                  Copy Configuration JSON
                </button>
              </div>
            )}

            {activeTab === "stdio-claude" && (
              <div className="mcp-preset-box">
                <p className="mcp-preset-desc">
                  To run vibeNote directly as a local stdio sub-process without starting the desktop app window, use the following configuration in your <code>claude_desktop_config.json</code>:
                </p>
                <pre>
                  <code>{getClaudeStdioConfig()}</code>
                </pre>
                <button className="btn btn-primary" onClick={() => copyToClipboard(getClaudeStdioConfig())}>
                  Copy Configuration JSON
                </button>
              </div>
            )}

            {activeTab === "stdio-gemini" && (
              <div className="mcp-preset-box">
                <p className="mcp-preset-desc">
                  To connect your command-line Gemini CLI engine, add this entry under the <code>mcpServers</code> section in your <code>~/.gemini/settings.json</code>:
                </p>
                <pre>
                  <code>{getGeminiConfig()}</code>
                </pre>
                <button className="btn btn-primary" onClick={() => copyToClipboard(getGeminiConfig())}>
                  Copy settings.json block
                </button>
              </div>
            )}

            {activeTab === "generic" && (
              <div className="mcp-preset-box">
                <p className="mcp-preset-desc">
                  For other client integration systems, point them to the raw HTTP Server-Sent Events stream:
                </p>
                <ul>
                  <li><strong>Endpoint Mode:</strong> SSE (Server-Sent Events)</li>
                  <li><strong>SSE Event URL:</strong> <code>{getSseUrl()}</code></li>
                  <li><strong>JSON-RPC Format:</strong> POST requests routed through the same endpoint.</li>
                </ul>
                <button className="btn btn-primary" onClick={() => copyToClipboard(getSseUrl())}>
                  Copy SSE URL
                </button>
              </div>
            )}
          </div>

          <div className="mcp-tools-section">
            <h4>🛠️ Available Semantic Tools ({tools.length})</h4>
            <div className="mcp-tools-list">
              {tools.map((t) => (
                <div className="mcp-tool-card" key={t.name}>
                  <strong><code>{t.name}</code></strong>
                  <p>{t.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Close Config
          </button>
        </div>
      </div>
    </div>
  );
};
export default McpConfigPopup;
