import React, { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

import { Sidebar } from "./components/Sidebar";
import { CollectionNav } from "./components/CollectionNav";
import { GraphCanvas } from "./components/GraphCanvas";
import { InspectorPanel } from "./components/InspectorPanel";
import { ListView } from "./components/ListView";
import { ContactsGrid } from "./components/ContactsGrid";
import { CalendarWeekView } from "./components/CalendarWeekView";
import { Collection, GraphNode, GraphEdge, HistoryEdge, GraphData, Toast } from "./types";

function App() {
  // Theme state
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const saved = localStorage.getItem("theme");
    if (saved === "dark" || saved === "light") return saved;
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
      return "light";
    }
    return "dark";
  });

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  // Shared state variables
  const [collections, setCollections] = useState<Collection[]>([]);
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], edges: [], history_edges: [] });
  const [selectedCollectionId, setSelectedCollectionId] = useState<string>("");
  const [selectedBrowseCollectionId, setSelectedBrowseCollectionId] = useState<string>("");
  const [activeMainTab, setActiveMainTab] = useState<"graph" | "specific">("graph");

  // Automatically switch tab when browse collection changes
  useEffect(() => {
    if (!selectedBrowseCollectionId) {
      setActiveMainTab("graph");
    }
  }, [selectedBrowseCollectionId]);

  // Collection creation state
  const [showAddCollectionOverlay, setShowAddCollectionOverlay] = useState(false);
  const [newColName, setNewColName] = useState("");
  const [newColType, setNewColType] = useState<"text" | "contacts" | "calendar">("text");
  const [newColFolder, setNewColFolder] = useState("");
  const [isFolderCustomized, setIsFolderCustomized] = useState(false);

  // Filter & UI States
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [showHistory, setShowHistory] = useState<boolean>(true);
  const [activeSidebarTab, setActiveSidebarTab] = useState<"workspace" | "search">("workspace");

  // Ingestion creation tab
  const [activeTab, setActiveTab] = useState<"text" | "contacts" | "calendar">("text");

  // Relation Link builder state
  const [sourceNodeId, setSourceNodeId] = useState("");
  const [targetNodeId, setTargetNodeId] = useState("");
  const [relationType, setRelationType] = useState("refers_to");

  // Selection & Edit Inspector state
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [nodeIdToCenter, setNodeIdToCenter] = useState<string | null>(null);

  // Toasts
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Web Mock Mode state
  const [isWebMode, setIsWebMode] = useState(false);
  const [activeVibePath, setActiveVibePath] = useState<string>("");
  const [showWorkspaceOverlay, setShowWorkspaceOverlay] = useState<boolean>(false);

  // Collapsible navigation column state
  const [isNavCollapsed, setIsNavCollapsed] = useState<boolean>(false);

  // Viewport offset/scale state
  const [zoom, setZoom] = useState(1.0);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const slugify = (text: string) => {
    return text
      .toString()
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')           // Replace spaces with -
      .replace(/[^\w\-]+/g, '')       // Remove all non-word chars
      .replace(/\-\-+/g, '-');        // Replace multiple - with single -
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setNewColName(val);
    if (!isFolderCustomized) {
      setNewColFolder(slugify(val));
    }
  };

  const resetAddCollectionForm = () => {
    setNewColName("");
    setNewColType("text");
    setNewColFolder("");
    setIsFolderCustomized(false);
  };

  const handleAddCollection = async () => {
    if (!newColName.trim()) {
      addToast("Collection name cannot be empty", "error");
      return;
    }
    if (!newColFolder.trim()) {
      addToast("Folder name cannot be empty", "error");
      return;
    }

    if (isWebMode) {
      const newCol: Collection = {
        id: `col-${Math.random().toString(36).substring(2, 9)}`,
        name: newColName,
        type: newColType,
        folder_path: newColFolder
      };
      mockDbRef.current.collections.push(newCol);
      setCollections([...mockDbRef.current.collections]);
      setActiveTab(newColType);
      setSelectedCollectionId(newCol.id);
      addToast(`Collection "${newCol.name}" created in Web Mode!`, "success");
      setShowAddCollectionOverlay(false);
      resetAddCollectionForm();
      return;
    }

    try {
      const newCol = await invoke<Collection>("add_collection", {
        name: newColName,
        collectionType: newColType,
        folderName: newColFolder,
      });
      addToast(`Collection "${newCol.name}" created successfully!`, "success");
      setShowAddCollectionOverlay(false);
      resetAddCollectionForm();
      
      // Refresh list
      const result = await invoke<Collection[]>("get_collections");
      setCollections(result);
      setActiveTab(newColType);
      setSelectedCollectionId(newCol.id);
    } catch (e) {
      addToast(String(e), "error");
    }
  };

  const mockDbRef = useRef<{
    collections: Collection[];
    nodes: GraphNode[];
    edges: GraphEdge[];
    history_edges: HistoryEdge[];
  }>({
    collections: [
      { id: "col-notes", name: "Demo Notes", type: "text", folder_path: "notes" },
      { id: "col-contacts", name: "Demo Contacts", type: "contacts", folder_path: "contacts" },
      { id: "col-calendar", name: "Demo Calendar", type: "calendar", folder_path: "calendar" }
    ],
    nodes: [
      {
        id: "p1",
        collection_id: "col-notes",
        uri: null,
        created_at: "2026-07-12T10:00:00Z",
        is_active: true,
        title: "Project Alpha Core Vision",
        content: "# Project Alpha Core Vision\nProject Alpha aims to build a fully local-first, privacy-respecting semantic desktop database. It stores items as atomic, immutable Pieces and structures them dynamically with an association graph.",
        metadata: {}
      },
      {
        id: "p2",
        collection_id: "col-notes",
        uri: null,
        created_at: "2026-07-12T10:05:00Z",
        is_active: true,
        title: "Architecture: USearch Vector Index",
        content: "# Architecture: USearch Vector Index\nWe use the USearch library (HNSW graph) to perform high-speed similarity searches locally on standard consumer computers, mapping embeddings using SSD-backed files.",
        metadata: {}
      },
      {
        id: "p3",
        collection_id: "col-notes",
        uri: null,
        created_at: "2026-07-12T10:10:00Z",
        is_active: false,
        title: "Performance Bottleneck: HNSW Rebuilding",
        content: "# Performance Bottleneck: High Capacity HNSW Rebuilding\nWhen the memory-mapped vector index reaches 100k vectors, memory constraints start causing significant page faults on lower-end devices. We need to implement vector quantization.",
        metadata: {}
      },
      {
        id: "p3-revised",
        collection_id: "col-notes",
        uri: null,
        created_at: "2026-07-12T12:00:00Z",
        is_active: true,
        title: "Performance Bottleneck: Quantization Fix Applied",
        content: "# Performance Bottleneck: Quantization Fix Applied\nWe implemented int8 vector quantization, which successfully resolved page faulting and reduced index RAM usage from 2.5GB to 550MB on target devices.",
        metadata: {}
      },
      {
        id: "c1",
        collection_id: "col-contacts",
        uri: null,
        created_at: "2026-07-12T10:15:00Z",
        is_active: true,
        title: "Alice Smith",
        content: "Contact profile for Alice Smith. Email: alice@codesmart.tech. Phone: +1-555-0199. Organization: Codesmart Tech. Title: Principal Architect.",
        metadata: {
          formatted_name: "Alice Smith",
          email: "alice@codesmart.tech",
          phone: "+1-555-0199",
          organization: "Codesmart Tech",
          title: "Principal Architect"
        }
      },
      {
        id: "c2",
        collection_id: "col-contacts",
        uri: null,
        created_at: "2026-07-12T10:20:00Z",
        is_active: true,
        title: "Bob Jones",
        content: "Contact profile for Bob Jones. Email: bob@codesmart.tech. Phone: +1-555-0144. Organization: Codesmart Tech. Title: Infrastructure Engineer.",
        metadata: {
          formatted_name: "Bob Jones",
          email: "bob@codesmart.tech",
          phone: "+1-555-0144",
          organization: "Codesmart Tech",
          title: "Infrastructure Engineer"
        }
      },
      {
        id: "e1",
        collection_id: "col-calendar",
        uri: null,
        created_at: "2026-07-12T10:25:00Z",
        is_active: true,
        title: "Project Alpha Launch",
        content: "Calendar event: Project Alpha Launch. Start time: 2026-08-01T09:00:00Z. End time: 2026-08-01T10:00:00Z. Description: Final release and production deployment. Location: War Room 1A.",
        metadata: {
          summary: "Project Alpha Launch",
          start_date: "2026-08-01T09:00:00Z",
          end_date: "2026-08-01T10:00:00Z",
          location: "War Room 1A",
          description: "Final release and production deployment of Project Alpha local database engines."
        }
      }
    ],
    edges: [
      { source: "p2", target: "p1", type: "part_of", created_at: "2026-07-12T10:30:00Z" },
      { source: "p3", target: "p2", type: "contradicts", created_at: "2026-07-12T10:31:00Z" },
      { source: "p3-revised", target: "p2", type: "optimizes", created_at: "2026-07-12T12:01:00Z" },
      { source: "c1", target: "p1", type: "manages", created_at: "2026-07-12T10:32:00Z" },
      { source: "c2", target: "p2", type: "implements", created_at: "2026-07-12T10:33:00Z" },
      { source: "e1", target: "p1", type: "schedules", created_at: "2026-07-12T10:34:00Z" },
      { source: "c1", target: "c2", type: "colleague_of", created_at: "2026-07-12T10:35:00Z" }
    ],
    history_edges: [
      { parent: "p3", child: "p3-revised", type: "replacement", timestamp: "2026-07-12T12:00:00Z" }
    ]
  });

  const addToast = (message: string, type: "success" | "error" = "success") => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  const loadWorkspace = async () => {
    try {
      const cols = await invoke<Collection[]>("get_collections");
      setCollections(cols);
      
      const data = await invoke<GraphData>("get_graph_data");
      setGraphData(data);
    } catch (e: any) {
      addToast(String(e), "error");
    }
  };

  const handlePickWorkspace = async () => {
    try {
      const selected = await invoke<string | null>("pick_vibe_directory");
      if (selected) {
        await invoke("change_vibe_directory", { path: selected });
        setActiveVibePath(selected);
        setShowWorkspaceOverlay(false);
        addToast("Vibe directory selected successfully!");
        await loadWorkspace();
      }
    } catch (e: any) {
      addToast(String(e), "error");
    }
  };

  const handleUseDefaultWorkspace = async () => {
    try {
      const defaultPath = await invoke<string>("get_active_vibe_path");
      await invoke("change_vibe_directory", { path: defaultPath });
      setActiveVibePath(defaultPath);
      setShowWorkspaceOverlay(false);
      addToast("Default Vibe directory initialized!");
      await loadWorkspace();
    } catch (e: any) {
      addToast(String(e), "error");
    }
  };

  const initializeApp = async () => {
    const hasTauri = typeof (window as any) !== "undefined" && (window as any).__TAURI_INTERNALS__ !== undefined;
    if (!hasTauri) {
      setIsWebMode(true);
      setActiveVibePath("Web Demo Vibe");
      setCollections(mockDbRef.current.collections);
      setGraphData({
        nodes: [...mockDbRef.current.nodes],
        edges: [...mockDbRef.current.edges],
        history_edges: [...mockDbRef.current.history_edges]
      });
      return;
    }

    try {
      const configured = await invoke<boolean>("is_workspace_configured");
      const path = await invoke<string>("get_active_vibe_path");
      setActiveVibePath(path);
      
      if (configured) {
        await loadWorkspace();
      } else {
        setShowWorkspaceOverlay(true);
      }
    } catch (e: any) {
      addToast(String(e), "error");
    }
  };

  useEffect(() => {
    initializeApp();
  }, []);

  const handleSeedData = async () => {
    if (isWebMode) {
      addToast("Demo knowledge base re-seeded in Web mode!");
      mockDbRef.current = {
        collections: [
          { id: "col-notes", name: "Demo Notes", type: "text", folder_path: "notes" },
          { id: "col-contacts", name: "Demo Contacts", type: "contacts", folder_path: "contacts" },
          { id: "col-calendar", name: "Demo Calendar", type: "calendar", folder_path: "calendar" }
        ],
        nodes: [
          {
            id: "p1",
            collection_id: "col-notes",
            uri: null,
            created_at: "2026-07-12T10:00:00Z",
            is_active: true,
            title: "Project Alpha Core Vision",
            content: "# Project Alpha Core Vision\nProject Alpha aims to build a fully local-first, privacy-respecting semantic desktop database. It stores items as atomic, immutable Pieces and structures them dynamically with an association graph.",
            metadata: {}
          },
          {
            id: "p2",
            collection_id: "col-notes",
            uri: null,
            created_at: "2026-07-12T10:05:00Z",
            is_active: true,
            title: "Architecture: USearch Vector Index",
            content: "# Architecture: USearch Vector Index\nWe use the USearch library (HNSW graph) to perform high-speed similarity searches locally on standard consumer computers, mapping embeddings using SSD-backed files.",
            metadata: {}
          },
          {
            id: "p3",
            collection_id: "col-notes",
            uri: null,
            created_at: "2026-07-12T10:10:00Z",
            is_active: false,
            title: "Performance Bottleneck: HNSW Rebuilding",
            content: "# Performance Bottleneck: High Capacity HNSW Rebuilding\nWhen the memory-mapped vector index reaches 100k vectors, memory constraints start causing significant page faults on lower-end devices. We need to implement vector quantization.",
            metadata: {}
          },
          {
            id: "p3-revised",
            collection_id: "col-notes",
            uri: null,
            created_at: "2026-07-12T12:00:00Z",
            is_active: true,
            title: "Performance Bottleneck: Quantization Fix Applied",
            content: "# Performance Bottleneck: Quantization Fix Applied\nWe implemented int8 vector quantization, which successfully resolved page faulting and reduced index RAM usage from 2.5GB to 550MB on target devices.",
            metadata: {}
          },
          {
            id: "c1",
            collection_id: "col-contacts",
            uri: null,
            created_at: "2026-07-12T10:15:00Z",
            is_active: true,
            title: "Alice Smith",
            content: "Contact profile for Alice Smith. Email: alice@codesmart.tech. Phone: +1-555-0199. Organization: Codesmart Tech. Title: Principal Architect.",
            metadata: {
              formatted_name: "Alice Smith",
              email: "alice@codesmart.tech",
              phone: "+1-555-0199",
              organization: "Codesmart Tech",
              title: "Principal Architect"
            }
          },
          {
            id: "c2",
            collection_id: "col-contacts",
            uri: null,
            created_at: "2026-07-12T10:20:00Z",
            is_active: true,
            title: "Bob Jones",
            content: "Contact profile for Bob Jones. Email: bob@codesmart.tech. Phone: +1-555-0144. Organization: Codesmart Tech. Title: Infrastructure Engineer.",
            metadata: {
              formatted_name: "Bob Jones",
              email: "bob@codesmart.tech",
              phone: "+1-555-0144",
              organization: "Codesmart Tech",
              title: "Infrastructure Engineer"
            }
          },
          {
            id: "e1",
            collection_id: "col-calendar",
            uri: null,
            created_at: "2026-07-12T10:25:00Z",
            is_active: true,
            title: "Project Alpha Launch",
            content: "Calendar event: Project Alpha Launch. Start time: 2026-08-01T09:00:00Z. End time: 2026-08-01T10:00:00Z. Description: Final release and production deployment. Location: War Room 1A.",
            metadata: {
              summary: "Project Alpha Launch",
              start_date: "2026-08-01T09:00:00Z",
              end_date: "2026-08-01T10:00:00Z",
              location: "War Room 1A",
              description: "Final release and production deployment of Project Alpha local database engines."
            }
          }
        ],
        edges: [
          { source: "p2", target: "p1", type: "part_of", created_at: "2026-07-12T10:30:00Z" },
          { source: "p3", target: "p2", type: "contradicts", created_at: "2026-07-12T10:31:00Z" },
          { source: "p3-revised", target: "p2", type: "optimizes", created_at: "2026-07-12T12:01:00Z" },
          { source: "c1", target: "p1", type: "manages", created_at: "2026-07-12T10:32:00Z" },
          { source: "c2", target: "p2", type: "implements", created_at: "2026-07-12T10:33:00Z" },
          { source: "e1", target: "p1", type: "schedules", created_at: "2026-07-12T10:34:00Z" },
          { source: "c1", target: "c2", type: "colleague_of", created_at: "2026-07-12T10:35:00Z" }
        ],
        history_edges: [
          { parent: "p3", child: "p3-revised", type: "replacement", timestamp: "2026-07-12T12:00:00Z" }
        ]
      };
      setGraphData({
        nodes: [...mockDbRef.current.nodes],
        edges: [...mockDbRef.current.edges],
        history_edges: [...mockDbRef.current.history_edges]
      });
      return;
    }

    try {
      addToast("Seeding demo knowledge base...", "success");
      await invoke("seed_demo_data");
      await loadWorkspace();
      addToast("Demo graph seeded successfully!", "success");
    } catch (e: any) {
      addToast(String(e), "error");
    }
  };

  const handleCreateRelation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceNodeId || !targetNodeId) {
      addToast("Select both source and target pieces to link", "error");
      return;
    }
    if (sourceNodeId === targetNodeId) {
      addToast("Cannot link a piece to itself", "error");
      return;
    }

    if (isWebMode) {
      const newEdge: GraphEdge = {
        source: sourceNodeId,
        target: targetNodeId,
        type: relationType,
        created_at: new Date().toISOString()
      };
      mockDbRef.current.edges.push(newEdge);
      setGraphData({
        nodes: [...mockDbRef.current.nodes],
        edges: [...mockDbRef.current.edges],
        history_edges: [...mockDbRef.current.history_edges]
      });
      setSourceNodeId("");
      setTargetNodeId("");
      addToast("Relation linked successfully in Web Mode!");
      return;
    }

    try {
      await invoke("link_pieces", {
        sourceId: sourceNodeId,
        targetId: targetNodeId,
        relationType,
      });
      setSourceNodeId("");
      setTargetNodeId("");
      addToast("Bidirectional semantic link created!");
      await loadWorkspace();
    } catch (e: any) {
      addToast(String(e), "error");
    }
  };

  // Mock State Modifier Callbacks
  const onAddMockPiece = (piece: GraphNode) => {
    mockDbRef.current.nodes.push(piece);
    setGraphData({
      nodes: [...mockDbRef.current.nodes],
      edges: [...mockDbRef.current.edges],
      history_edges: [...mockDbRef.current.history_edges]
    });
  };

  const onReplaceMockPiece = (oldId: string, newPiece: GraphNode) => {
    const oldNode = mockDbRef.current.nodes.find((n) => n.id === oldId);
    if (oldNode) oldNode.is_active = false;

    mockDbRef.current.nodes.push(newPiece);
    mockDbRef.current.history_edges.push({
      parent: oldId,
      child: newPiece.id,
      type: "replacement",
      timestamp: new Date().toISOString()
    });

    setGraphData({
      nodes: [...mockDbRef.current.nodes],
      edges: [...mockDbRef.current.edges],
      history_edges: [...mockDbRef.current.history_edges]
    });
  };

  const onTombstoneMockPiece = (id: string) => {
    const node = mockDbRef.current.nodes.find((n) => n.id === id);
    if (node) {
      node.is_active = false;
    }
    setGraphData({
      nodes: [...mockDbRef.current.nodes],
      edges: [...mockDbRef.current.edges],
      history_edges: [...mockDbRef.current.history_edges]
    });
  };

  const centerOnNode = (nodeId: string) => {
    setNodeIdToCenter(nodeId);
  };

  return (
    <div className="dashboard-root">
      
      {/* Toast Notification HUD */}
      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type === "error" ? "error" : ""}`}>
            <span>{t.message}</span>
            <button className="toast-close" onClick={() => setToasts((prev) => prev.filter((item) => item.id !== t.id))}>×</button>
          </div>
        ))}
      </div>

      {/* Workspace Manager Overlay */}
      {showWorkspaceOverlay && (
        <div className="workspace-overlay">
          <div className="glass-panel workspace-modal animate-scale-up">
            <header className="workspace-header">
              <h1>vibeNote</h1>
              <p className="subtitle">Select or Create a Vibe</p>
            </header>
            <div className="workspace-body">
              <p className="description">
                vibeNote organizes your thoughts, contacts, and calendar events semantically inside a local directory called a <strong>Vibe</strong>.
              </p>
              
              <div className="path-display-box">
                <span className="label">Active Path:</span>
                <code className="path-text">{activeVibePath || "None (First Launch)"}</code>
              </div>

              <div className="actions-group">
                <button className="btn btn-primary btn-block" onClick={handlePickWorkspace}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: "8px", verticalAlign: "middle" }}>
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                  </svg>
                  Select / Create Local Vibe Directory
                </button>
                
                <button className="btn btn-secondary btn-block" style={{ marginTop: "12px" }} onClick={handleUseDefaultWorkspace}>
                  Use Default Workspace (~/.vibenote)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Collection Overlay */}
      {showAddCollectionOverlay && (
        <div className="workspace-overlay" style={{ zIndex: 300 }}>
          <div className="glass-panel workspace-modal animate-scale-up" style={{ maxWidth: "420px" }}>
            <header className="workspace-header">
              <h1>New Collection</h1>
              <p className="subtitle">Create a flat directory collection</p>
            </header>
            <div className="workspace-body" style={{ textAlign: "left", width: "100%", display: "flex", flexDirection: "column", gap: "16px" }}>
              <div className="form-group" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-secondary)" }}>Collection Name</label>
                <input 
                  type="text" 
                  className="search-input" 
                  value={newColName} 
                  onChange={handleNameChange} 
                  placeholder="e.g. Work Notes, My Clients" 
                  style={{ width: "100%" }}
                />
              </div>

              <div className="form-group" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-secondary)" }}>Collection Type</label>
                <select 
                  className="search-input" 
                  value={newColType} 
                  onChange={(e) => setNewColType(e.target.value as any)}
                  style={{ width: "100%", padding: "8px" }}
                >
                  <option value="text">Notes (Plain Text / Markdown)</option>
                  <option value="contacts">Contacts (vCard / Contacts)</option>
                  <option value="calendar">Calendar (iCalendar / Event)</option>
                </select>
              </div>

              <div className="form-group" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-secondary)" }}>Folder Name</label>
                <input 
                  type="text" 
                  className="search-input" 
                  value={newColFolder} 
                  onChange={(e) => {
                    setNewColFolder(e.target.value);
                    setIsFolderCustomized(true);
                  }} 
                  placeholder="e.g. work-notes" 
                  style={{ width: "100%" }}
                />
              </div>

              <div className="actions-group" style={{ display: "flex", gap: "12px", marginTop: "12px" }}>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleAddCollection}>
                  Create
                </button>
                <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => {
                  setShowAddCollectionOverlay(false);
                  resetAddCollectionForm();
                }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* LEFT SIDEBAR */}
      <Sidebar
        theme={theme}
        toggleTheme={toggleTheme}
        activeVibePath={activeVibePath}
        isWebMode={isWebMode}
        setShowWorkspaceOverlay={setShowWorkspaceOverlay}
        collections={collections}
        activeSidebarTab={activeSidebarTab}
        setActiveSidebarTab={setActiveSidebarTab}
        selectedCollectionId={selectedCollectionId}
        setSelectedCollectionId={setSelectedCollectionId}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        loadWorkspace={loadWorkspace}
        onAddMockPiece={onAddMockPiece}
        sourceNodeId={sourceNodeId}
        setSourceNodeId={setSourceNodeId}
        targetNodeId={targetNodeId}
        setTargetNodeId={setTargetNodeId}
        relationType={relationType}
        setRelationType={setRelationType}
        handleCreateRelation={handleCreateRelation}
        graphData={graphData}
        selectedNode={selectedNode}
        centerOnNode={centerOnNode}
        addToast={addToast}
      />

      {/* COLLECTION NAVIGATION COLUMN */}
      <CollectionNav
        collections={collections}
        selectedBrowseCollectionId={selectedBrowseCollectionId}
        setSelectedBrowseCollectionId={setSelectedBrowseCollectionId}
        graphNodes={graphData.nodes}
        onAddCollectionClick={() => setShowAddCollectionOverlay(true)}
        isNavCollapsed={isNavCollapsed}
        setIsNavCollapsed={setIsNavCollapsed}
      />

      {/* CENTER WORKSPACE: Interactive 2D Graph Visualizer */}
      <section className="workspace-center">
        {/* Collection view selector tabs */}
        {selectedBrowseCollectionId && (
          <div className="main-tab-bar">
            <button
              className={`tab-btn ${activeMainTab === "graph" ? "active" : ""}`}
              onClick={() => setActiveMainTab("graph")}
            >
              🌐 Graph View
            </button>
            <button
              className={`tab-btn ${activeMainTab === "specific" ? "active" : ""}`}
              onClick={() => setActiveMainTab("specific")}
            >
              {(() => {
                const col = collections.find(c => c.id === selectedBrowseCollectionId);
                if (col?.type === "text") return "📝 List View";
                if (col?.type === "contacts") return "👤 Contacts Grid";
                if (col?.type === "calendar") return "📅 Week Schedule";
                return "🗂️ Specific View";
              })()}
            </button>
          </div>
        )}

        {/* Floating Top Header Options */}
        <div className="top-controls-bar" style={{ display: activeMainTab === "graph" ? "flex" : "none" }}>
          <div className="search-container">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: "var(--text-muted)" }}>
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input 
              id="search-input"
              className="search-input" 
              placeholder="Search pieces..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="filter-controls">
            <label className="checkbox-label">
              <input 
                id="toggle-history"
                type="checkbox" 
                checked={showHistory} 
                onChange={(e) => setShowHistory(e.target.checked)}
              />
              Show Historical Versions (Inactive)
            </label>
            <button id="btn-reset-view" className="btn btn-secondary" onClick={() => { setZoom(1.0); setPan({ x: 0, y: 0 }); }}>
              Reset Viewport
            </button>
          </div>
        </div>

        {/* Legend */}
        <div className="graph-legend" style={{ display: activeMainTab === "graph" ? "flex" : "none" }}>
          <div className="legend-item">
            <div className="legend-dot text"></div>
            <span>Plain Notes (Markdown)</span>
          </div>
          <div className="legend-item">
            <div className="legend-dot contacts"></div>
            <span>Contacts (vCard)</span>
          </div>
          <div className="legend-item">
            <div className="legend-dot calendar"></div>
            <span>Events (iCal)</span>
          </div>
          <div className="legend-item">
            <div className="legend-dot inactive"></div>
            <span>Historical Versions</span>
          </div>
        </div>

        {graphData.nodes.length === 0 ? (
          <div className="empty-state">
            <h3>Knowledge Base Empty</h3>
            <p>To populate your graph, either ingest items using the left sidebar or seed the prebuilt demonstration network.</p>
            <button className="btn btn-primary" onClick={handleSeedData}>
              Seed Demo Database
            </button>
          </div>
        ) : (
          <>
            <div style={{ display: activeMainTab === "graph" ? "block" : "none", height: "100%", width: "100%" }}>
              <GraphCanvas
                graphData={graphData}
                collections={collections}
                theme={theme}
                selectedNode={selectedNode}
                setSelectedNode={setSelectedNode}
                searchQuery={searchQuery}
                showHistory={showHistory}
                selectedBrowseCollectionId={selectedBrowseCollectionId}
                sourceNodeId={sourceNodeId}
                setSourceNodeId={setSourceNodeId}
                targetNodeId={targetNodeId}
                setTargetNodeId={setTargetNodeId}
                zoom={zoom}
                setZoom={setZoom}
                pan={pan}
                setPan={setPan}
                nodeIdToCenter={nodeIdToCenter}
                setNodeIdToCenter={setNodeIdToCenter}
              />
            </div>

            {activeMainTab === "specific" && (
              <div className="type-specific-view-container" style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", width: "100%" }}>
                {(() => {
                  const col = collections.find(c => c.id === selectedBrowseCollectionId);
                  const filteredNodes = graphData.nodes.filter(n => n.collection_id === selectedBrowseCollectionId);
                  if (col?.type === "text") {
                    return (
                      <ListView
                        nodes={filteredNodes}
                        selectedNode={selectedNode}
                        setSelectedNode={setSelectedNode}
                        searchQuery={searchQuery}
                      />
                    );
                  }
                  if (col?.type === "contacts") {
                    return (
                      <ContactsGrid
                        nodes={filteredNodes}
                        selectedNode={selectedNode}
                        setSelectedNode={setSelectedNode}
                        searchQuery={searchQuery}
                      />
                    );
                  }
                  if (col?.type === "calendar") {
                    return (
                      <CalendarWeekView
                        nodes={filteredNodes}
                        selectedNode={selectedNode}
                        setSelectedNode={setSelectedNode}
                        searchQuery={searchQuery}
                      />
                    );
                  }
                  return null;
                })()}
              </div>
            )}
          </>
        )}
      </section>

      {/* RIGHT SIDEBAR: Selected Node Details Inspector */}
      <aside className="glass-panel right-sidebar">
        <header className="panel-header">
          <h2>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="16" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
            Detail Inspector
          </h2>
          <p>Piece Metadata & Contents</p>
        </header>

        <div className="panel-content">
          <InspectorPanel
            selectedNode={selectedNode}
            setSelectedNode={setSelectedNode}
            collections={collections}
            isWebMode={isWebMode}
            addToast={addToast}
            loadWorkspace={loadWorkspace}
            onReplaceMockPiece={onReplaceMockPiece}
            onTombstoneMockPiece={onTombstoneMockPiece}
          />
        </div>
      </aside>

    </div>
  );
}

export default App;
