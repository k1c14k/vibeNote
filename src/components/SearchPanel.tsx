import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Collection, GraphNode, GraphData } from "../types";

interface SearchPanelProps {
  collections: Collection[];
  graphData: GraphData;
  selectedNode: GraphNode | null;
  centerOnNode: (id: string) => void;
  isWebMode: boolean;
  addToast: (msg: string, type?: "success" | "error") => void;
}

export const SearchPanel: React.FC<SearchPanelProps> = ({
  collections,
  graphData,
  selectedNode,
  centerOnNode,
  isWebMode,
  addToast,
}) => {
  const [semanticQuery, setSemanticQuery] = useState("");
  const [selectedSearchCollectionId, setSelectedSearchCollectionId] = useState("");
  const [searchLimit, setSearchLimit] = useState(10);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const getColName = (colId: string) => {
    const col = collections.find((c) => c.id === colId);
    return col ? col.name : "Unknown Collection";
  };

  const getColType = (colId: string) => {
    const col = collections.find((c) => c.id === colId);
    return col ? col.type : "text";
  };

  const getPieceTitle = (item: any) => {
    if (item.metadata && item.metadata.formatted_name) {
      return item.metadata.formatted_name;
    }
    if (item.metadata && item.metadata.summary) {
      return item.metadata.summary;
    }
    const clean = (item.content || "").trim();
    if (!clean) return `Note (${item.id.substring(0, 8)})`;
    const firstLine = clean.split("\n")[0].trim().replace(/^#+\s+/, "");
    if (firstLine.length > 35) {
      return firstLine.substring(0, 32) + "...";
    }
    return firstLine || `Note (${item.id.substring(0, 8)})`;
  };

  const handleSemanticSearch = async () => {
    if (!semanticQuery.trim()) {
      addToast("Please enter a query string", "error");
      return;
    }

    if (isWebMode) {
      setIsSearching(true);
      setTimeout(() => {
        const queryWords = semanticQuery.toLowerCase().split(/\s+/).filter(w => w.length > 0);
        if (queryWords.length === 0) {
          setSearchResults([]);
          setIsSearching(false);
          return;
        }

        let filtered = graphData.nodes;
        if (selectedSearchCollectionId) {
          filtered = filtered.filter(n => n.collection_id === selectedSearchCollectionId);
        }

        const scored = filtered.map(node => {
          const title = node.title.toLowerCase();
          const content = node.content.toLowerCase();

          let matches = 0;
          queryWords.forEach(word => {
            if (title.includes(word)) {
              matches += 2;
            }
            if (content.includes(word)) {
              matches += 1;
            }
          });

          const maxPossible = queryWords.length * 3;
          const rawScore = matches / maxPossible;
          const similarity = matches > 0 ? 0.4 + (rawScore * 0.55) : 0.0;

          return {
            piece: {
              id: node.id,
              collection_id: node.collection_id,
              uri: node.uri,
              created_at: node.created_at,
              is_active: node.is_active,
              content: node.content,
              metadata: node.metadata
            },
            similarity: Math.min(similarity, 0.98)
          };
        })
        .filter(item => item.similarity > 0)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, searchLimit);

        setSearchResults(scored);
        setIsSearching(false);
      }, 400);
      return;
    }

    setIsSearching(true);
    try {
      const results = await invoke<any[]>("search_vibe", {
        query: semanticQuery,
        collectionId: selectedSearchCollectionId || null,
        limit: searchLimit,
      });
      setSearchResults(results);
    } catch (e: any) {
      addToast(String(e), "error");
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="semantic-search-panel" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <h4 className="panel-section-title">Semantic Vector Search</h4>

      <form onSubmit={(e) => { e.preventDefault(); handleSemanticSearch(); }} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <div className="form-group">
          <label htmlFor="semantic-search-input">Natural Language Query</label>
          <input
            id="semantic-search-input"
            className="form-control"
            placeholder="Search query (e.g. core specs of RAG index)"
            value={semanticQuery}
            onChange={(e) => setSemanticQuery(e.target.value)}
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="semantic-search-collection">Filter by Category</label>
          <select
            id="semantic-search-collection"
            className="form-control"
            value={selectedSearchCollectionId}
            onChange={(e) => setSelectedSearchCollectionId(e.target.value)}
          >
            <option value="">-- All Collections --</option>
            {collections.map((col) => (
              <option key={col.id} value={col.id}>
                {col.name} ({col.type})
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
            <label htmlFor="semantic-search-limit">Max Matches: <strong>{searchLimit}</strong></label>
          </div>
          <input
            id="semantic-search-limit"
            type="range"
            min="1"
            max="30"
            className="slider-control"
            value={searchLimit}
            onChange={(e) => setSearchLimit(parseInt(e.target.value))}
          />
        </div>

        <button id="btn-semantic-search" className="btn btn-primary btn-block" type="submit" disabled={isSearching} style={{ marginTop: "4px" }}>
          {isSearching ? "Searching..." : "Execute Semantic Search"}
        </button>
      </form>

      <div className="search-results-section" style={{ marginTop: "12px" }}>
        <div className="search-results-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", borderBottom: "1px solid var(--border-color)", paddingBottom: "6px" }}>
          <span className="panel-section-title" style={{ marginBottom: 0 }}>Results ({searchResults.length})</span>
          {searchResults.length > 0 && (
            <button className="btn-text-only" onClick={() => setSearchResults([])} style={{ background: "none", border: "none", color: "var(--accent-red)", cursor: "pointer", fontSize: "0.75rem" }}>Clear</button>
          )}
        </div>

        {isSearching ? (
          <div className="search-loading" style={{ textAlign: "center", padding: "30px 10px", color: "var(--text-secondary)" }}>
            <div className="spinner-loader" style={{ width: "24px", height: "24px", border: "3px solid rgba(255,255,255,0.1)", borderTopColor: "var(--accent-purple)", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 12px" }}></div>
            <p style={{ fontSize: "0.8rem" }}>Embedding query & querying USearch graph...</p>
          </div>
        ) : searchResults.length === 0 ? (
          <div className="search-empty-state" style={{ color: "var(--text-muted)", fontSize: "0.8rem", textAlign: "center", padding: "20px 10px" }}>
            <p>{semanticQuery ? "No matches found." : "Run a semantic search to find similarity-ranked pieces from your workspace."}</p>
          </div>
        ) : (
          <div className="search-results-list" style={{ display: "flex", flexDirection: "column", gap: "12px", maxHeight: "400px", overflowY: "auto", paddingRight: "4px" }}>
            {searchResults.map((result) => {
              const item = result.piece;
              const colType = getColType(item.collection_id);
              const colName = getColName(item.collection_id);
              const displayTitle = getPieceTitle(item);

              return (
                <div
                  key={item.id}
                  className={`search-result-card ${selectedNode?.id === item.id ? "active" : ""}`}
                  onClick={() => centerOnNode(item.id)}
                  style={{
                    background: selectedNode?.id === item.id ? "rgba(157, 78, 221, 0.08)" : "rgba(255,255,255,0.03)",
                    border: `1px solid ${selectedNode?.id === item.id ? "var(--accent-purple)" : "var(--border-color)"}`,
                    borderRadius: "8px",
                    padding: "12px",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                  }}
                >
                  <div className="result-card-meta" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                    <span className={`badge-type ${colType}`} style={{ fontSize: "0.7rem", padding: "2px 6px", borderRadius: "4px" }}>{colName}</span>
                    <span className="relevance-score" style={{ fontSize: "0.75rem", fontWeight: "600", color: "var(--accent-teal)" }}>
                      {(result.similarity * 100).toFixed(1)}% match
                    </span>
                  </div>
                  <div className="result-card-title" style={{ fontSize: "0.85rem", fontWeight: "600", color: "var(--text-primary)", marginBottom: "4px" }}>{displayTitle}</div>
                  <div className="result-card-snippet" style={{ fontSize: "0.75rem", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{item.content}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
export default SearchPanel;
