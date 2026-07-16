import React from "react";
import { Collection, GraphNode } from "../types";

interface CollectionNavProps {
  collections: Collection[];
  selectedBrowseCollectionId: string;
  setSelectedBrowseCollectionId: (id: string) => void;
  graphNodes: GraphNode[];
  onAddCollectionClick: () => void;
  isNavCollapsed: boolean;
  setIsNavCollapsed: (collapsed: boolean) => void;
}

export const CollectionNav: React.FC<CollectionNavProps> = ({
  collections,
  selectedBrowseCollectionId,
  setSelectedBrowseCollectionId,
  graphNodes,
  onAddCollectionClick,
  isNavCollapsed,
  setIsNavCollapsed,
}) => {
  const getCollectionCount = (colId: string) => {
    return graphNodes.filter((n) => n.collection_id === colId && n.is_active).length;
  };

  const getCollectionIcon = (type: "text" | "contacts" | "calendar") => {
    switch (type) {
      case "text":
        return "📝";
      case "contacts":
        return "👤";
      case "calendar":
        return "📅";
      default:
        return "🗂️";
    }
  };

  return (
    <nav className={`collection-nav-panel ${isNavCollapsed ? "collapsed" : ""}`}>
      <div className="collection-nav-header">
        <h3>{!isNavCollapsed && "Collections"}</h3>
        <button
          className="collapse-toggle-btn"
          onClick={() => setIsNavCollapsed(!isNavCollapsed)}
          title={isNavCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
          aria-label={isNavCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
        >
          {isNavCollapsed ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M9 18l6-6-6-6" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          )}
        </button>
      </div>

      <div className="collection-nav-list">
        {/* All Collections option */}
        <div
          className={`collection-nav-item ${selectedBrowseCollectionId === "" ? "active" : ""}`}
          onClick={() => setSelectedBrowseCollectionId("")}
          title="All Collections"
        >
          <div className="collection-nav-item-content">
            <span className="collection-nav-icon">🗂️</span>
            {!isNavCollapsed && <span className="collection-nav-name">All Collections</span>}
          </div>
          {!isNavCollapsed && (
            <span className="collection-nav-count">
              {graphNodes.filter((n) => n.is_active).length}
            </span>
          )}
        </div>

        {/* Dynamic Collections list */}
        {collections.map((col) => {
          const count = getCollectionCount(col.id);
          const icon = getCollectionIcon(col.type);
          const isActive = selectedBrowseCollectionId === col.id;

          return (
            <div
              key={col.id}
              className={`collection-nav-item ${isActive ? "active" : ""}`}
              onClick={() => setSelectedBrowseCollectionId(col.id)}
              title={`${col.name} (${col.type})`}
            >
              <div className="collection-nav-item-content">
                <span className="collection-nav-icon">{icon}</span>
                {!isNavCollapsed && <span className="collection-nav-name">{col.name}</span>}
              </div>
              {!isNavCollapsed && (
                <span className="collection-nav-count">{count}</span>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ padding: "12px", borderTop: "1px solid var(--border-color)", display: "flex", justifyContent: "center" }}>
        <button
          className="btn btn-secondary btn-block"
          onClick={onAddCollectionClick}
          title="New Collection"
          style={{ padding: isNavCollapsed ? "8px 0" : "8px 16px" }}
        >
          {isNavCollapsed ? "+" : "+ New Collection"}
        </button>
      </div>
    </nav>
  );
};
export default CollectionNav;
