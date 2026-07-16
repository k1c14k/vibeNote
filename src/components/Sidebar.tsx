import React from "react";
import { PieceForm } from "./PieceForm";
import { SearchPanel } from "./SearchPanel";
import { Collection, GraphNode, GraphData } from "../types";

interface SidebarProps {
  theme: "dark" | "light";
  toggleTheme: () => void;
  activeVibePath: string;
  isWebMode: boolean;
  setShowWorkspaceOverlay: (show: boolean) => void;
  collections: Collection[];
  
  // Tab states
  activeSidebarTab: "workspace" | "search";
  setActiveSidebarTab: (tab: "workspace" | "search") => void;

  // Ingestion form state
  selectedCollectionId: string;
  setSelectedCollectionId: (id: string) => void;
  activeTab: "text" | "contacts" | "calendar";
  setActiveTab: (tab: "text" | "contacts" | "calendar") => void;
  loadWorkspace: () => Promise<void>;
  onAddMockPiece: (piece: GraphNode) => void;
  
  // Relation builder state
  sourceNodeId: string;
  setSourceNodeId: (id: string) => void;
  targetNodeId: string;
  setTargetNodeId: (id: string) => void;
  relationType: string;
  setRelationType: (type: string) => void;
  handleCreateRelation: (e: React.FormEvent) => Promise<void>;
  
  // Search state & action
  graphData: GraphData;
  selectedNode: GraphNode | null;
  centerOnNode: (id: string) => void;
  
  addToast: (msg: string, type?: "success" | "error") => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  theme,
  toggleTheme,
  activeVibePath,
  isWebMode,
  setShowWorkspaceOverlay,
  collections,
  activeSidebarTab,
  setActiveSidebarTab,
  selectedCollectionId,
  setSelectedCollectionId,
  activeTab,
  setActiveTab,
  loadWorkspace,
  onAddMockPiece,
  sourceNodeId,
  setSourceNodeId,
  targetNodeId,
  setTargetNodeId,
  relationType,
  setRelationType,
  handleCreateRelation,
  graphData,
  selectedNode,
  centerOnNode,
  addToast,
}) => {
  return (
    <aside className="glass-panel left-sidebar">
      <header className="panel-header">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
            vibeNote
          </h2>
          <button
            id="theme-toggle-btn"
            className="btn-icon"
            title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
            onClick={toggleTheme}
            style={{ padding: "6px", display: "inline-flex", alignItems: "center" }}
          >
            {theme === "dark" ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5"></circle>
                <line x1="12" y1="1" x2="12" y2="3"></line>
                <line x1="12" y1="21" x2="12" y2="23"></line>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                <line x1="1" y1="12" x2="3" y2="12"></line>
                <line x1="21" y1="12" x2="23" y2="12"></line>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
              </svg>
            )}
          </button>
        </div>
        <p>Local PKM Semantic Engine {isWebMode && " (Web Demo)"}</p>

        {activeVibePath && (
          <div className="workspace-info-box">
            <span className="workspace-label" title={activeVibePath}>
              Vibe: <code>{activeVibePath.length > 25 ? "..." + activeVibePath.substring(activeVibePath.length - 22) : activeVibePath}</code>
            </span>
            {!isWebMode && (
              <button
                className="btn-icon"
                title="Switch Vibe"
                onClick={() => setShowWorkspaceOverlay(true)}
                style={{ background: "none", border: "none", color: "var(--primary-glow)", cursor: "pointer", display: "inline-flex", alignItems: "center", marginLeft: "6px" }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                </svg>
              </button>
            )}
          </div>
        )}
      </header>

      <div className="sidebar-tabs">
        <button
          id="tab-btn-workspace"
          className={`sidebar-tab ${activeSidebarTab === "workspace" ? "active" : ""}`}
          onClick={() => setActiveSidebarTab("workspace")}
        >
          Workspace Tools
        </button>
        <button
          id="tab-btn-search"
          className={`sidebar-tab ${activeSidebarTab === "search" ? "active" : ""}`}
          onClick={() => setActiveSidebarTab("search")}
        >
          Semantic Search
        </button>
      </div>

      <div className="panel-content">
        {activeSidebarTab === "workspace" ? (
          <>
            {/* Ingestion Hub */}
            <PieceForm
              collections={collections}
              selectedCollectionId={selectedCollectionId}
              setSelectedCollectionId={setSelectedCollectionId}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              isWebMode={isWebMode}
              addToast={addToast}
              loadWorkspace={loadWorkspace}
              onAddMockPiece={onAddMockPiece}
            />

            {/* Relation Builder */}
            <div>
              <h4 className="panel-section-title">Link Pieces</h4>
              <form onSubmit={handleCreateRelation}>
                <div className="form-group">
                  <label htmlFor="link-source">Source Piece ID / Selected</label>
                  <input
                    id="link-source"
                    className="form-control"
                    value={sourceNodeId}
                    onChange={(e) => setSourceNodeId(e.target.value)}
                    placeholder="Paste UUID or click node"
                    style={{ fontSize: "0.75rem" }}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="link-target">Target Piece ID / Selected</label>
                  <input
                    id="link-target"
                    className="form-control"
                    value={targetNodeId}
                    onChange={(e) => setTargetNodeId(e.target.value)}
                    placeholder="Paste UUID or click 2nd node"
                    style={{ fontSize: "0.75rem" }}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="link-type">Relation Tag</label>
                  <select
                    id="link-type"
                    className="form-control"
                    value={relationType}
                    onChange={(e) => setRelationType(e.target.value)}
                  >
                    <option value="refers_to">refers_to</option>
                    <option value="supports">supports</option>
                    <option value="contradicts">contradicts</option>
                    <option value="part_of">part_of</option>
                    <option value="manages">manages</option>
                    <option value="implements">implements</option>
                    <option value="schedules">schedules</option>
                    <option value="colleague_of">colleague_of</option>
                  </select>
                </div>
                <button id="btn-link" className="btn btn-secondary btn-block" type="submit">
                  Forge Bidirectional Link
                </button>
              </form>
            </div>
          </>
        ) : (
          /* Semantic Search Tab Content */
          <SearchPanel
            collections={collections}
            graphData={graphData}
            selectedNode={selectedNode}
            centerOnNode={centerOnNode}
            isWebMode={isWebMode}
            addToast={addToast}
          />
        )}
      </div>
    </aside>
  );
};
export default Sidebar;
