import React, { useState } from "react";
import { GraphNode } from "../types";

interface ListViewProps {
  nodes: GraphNode[];
  selectedNode: GraphNode | null;
  setSelectedNode: (node: GraphNode | null) => void;
  searchQuery: string;
}

export const ListView: React.FC<ListViewProps> = ({
  nodes,
  selectedNode,
  setSelectedNode,
  searchQuery,
}) => {
  const [sortBy, setSortBy] = useState<"date-new" | "date-old" | "title-az" | "title-za">("date-new");

  // Filter notes by search query
  const filteredNotes = nodes.filter((node) => {
    if (!node.is_active) return false; // Hide inactive notes by default
    const titleMatch = node.title.toLowerCase().includes(searchQuery.toLowerCase());
    const contentMatch = node.content.toLowerCase().includes(searchQuery.toLowerCase());
    return titleMatch || contentMatch;
  });

  // Sort notes
  const sortedNotes = [...filteredNotes].sort((a, b) => {
    if (sortBy === "date-new") {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    } else if (sortBy === "date-old") {
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    } else if (sortBy === "title-az") {
      return a.title.localeCompare(b.title);
    } else {
      return b.title.localeCompare(a.title);
    }
  });

  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="notes-list-view animate-fade-in">
      <div className="notes-list-header">
        <span className="notes-count">
          Showing {sortedNotes.length} note{sortedNotes.length !== 1 ? "s" : ""}
        </span>
        <div className="sort-control">
          <label htmlFor="note-sort">Sort by:</label>
          <select
            id="note-sort"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="form-control"
          >
            <option value="date-new">Date (Newest First)</option>
            <option value="date-old">Date (Oldest First)</option>
            <option value="title-az">Title (A-Z)</option>
            <option value="title-za">Title (Z-A)</option>
          </select>
        </div>
      </div>

      <div className="notes-list-items">
        {sortedNotes.length === 0 ? (
          <div className="empty-notes-state">
            <p>No notes found matching the current search query.</p>
          </div>
        ) : (
          sortedNotes.map((node) => {
            const isSelected = selectedNode?.id === node.id;
            return (
              <div
                key={node.id}
                className={`note-list-item ${isSelected ? "selected" : ""}`}
                onClick={() => setSelectedNode(node)}
              >
                <div className="note-item-header">
                  <h4 className="note-item-title">{node.title}</h4>
                  <span className="note-item-date">{formatDate(node.created_at)}</span>
                </div>
                <p className="note-item-preview">
                  {node.content.replace(/#+\s+.*(\n|$)/g, "").substring(0, 140)}
                  {node.content.length > 140 ? "..." : ""}
                </p>
                {Object.keys(node.metadata).length > 0 && (
                  <div className="note-item-tags">
                    {Object.entries(node.metadata).map(([key, val]) => (
                      <span key={key} className="note-tag">
                        {key}: {val}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
export default ListView;
