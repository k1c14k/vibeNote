import React, { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

// Interface Definitions
interface Collection {
  id: string;
  name: string;
  type: "text" | "contacts" | "calendar";
  folder_path: string;
}

interface GraphNode {
  id: string;
  collection_id: string;
  uri: string | null;
  created_at: string;
  is_active: boolean;
  title: string;
  content: string;
  metadata: Record<string, string>;
  
  // Physics simulation coordinates
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

interface GraphEdge {
  source: string;
  target: string;
  type: string;
  created_at: string;
}

interface HistoryEdge {
  parent: string;
  child: string;
  type: "replacement" | "extension";
  timestamp: string;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  history_edges: HistoryEdge[];
}

interface Toast {
  id: string;
  message: string;
  type: "success" | "error";
}

function App() {
  // State variables
  const [collections, setCollections] = useState<Collection[]>([]);
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], edges: [], history_edges: [] });
  const [selectedCollectionId, setSelectedCollectionId] = useState<string>("");
  
  // Filters
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [showHistory, setShowHistory] = useState<boolean>(true);
  
  // Creation Form State
  const [activeTab, setActiveTab] = useState<"text" | "contacts" | "calendar">("text");
  const [noteContent, setNoteContent] = useState("");
  
  // Contact state
  const [contactFirst, setContactFirst] = useState("");
  const [contactLast, setContactLast] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactOrg, setContactOrg] = useState("");
  const [contactTitle, setContactTitle] = useState("");

  // Event state
  const [eventSummary, setEventSummary] = useState("");
  const [eventStart, setEventStart] = useState("");
  const [eventEnd, setEventEnd] = useState("");
  const [eventDesc, setEventDesc] = useState("");
  const [eventLoc, setEventLoc] = useState("");

  // Relation Link builder state
  const [sourceNodeId, setSourceNodeId] = useState("");
  const [targetNodeId, setTargetNodeId] = useState("");
  const [relationType, setRelationType] = useState("refers_to");

  // Selection & Edit Inspector state
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState("");

  // Toasts list
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Web Mock Mode state (runs when browser doesn't have Tauri internals)
  const [isWebMode, setIsWebMode] = useState(false);

  // Workspace management state
  const [activeVibePath, setActiveVibePath] = useState<string>("");
  const [showWorkspaceOverlay, setShowWorkspaceOverlay] = useState<boolean>(false);
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

  // Refs for HTML5 Canvas Visualizer
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simNodesRef = useRef<GraphNode[]>([]);
  const animationFrameId = useRef<number | null>(null);
  
  // Zoom & Pan offset
  const [zoom, setZoom] = useState(1.0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1.0);
  
  // Mouse interaction state
  const isDraggingCanvas = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const draggedNodeIndex = useRef<number | null>(null);
  const hoveredNodeIndex = useRef<number | null>(null);

  // Sync references
  useEffect(() => {
    panRef.current = pan;
  }, [pan]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  // Toast helper
  const addToast = (message: string, type: "success" | "error" = "success") => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  // Load initial configurations
  const loadWorkspace = async () => {
    try {
      const cols = await invoke<Collection[]>("get_collections");
      setCollections(cols);
      if (cols.length > 0) {
        setSelectedCollectionId(cols[0].id);
      }
      
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
      setSelectedCollectionId(mockDbRef.current.collections[0].id);
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

  // Update simulation nodes when database changes
  useEffect(() => {
    const activeFilter = showHistory ? () => true : (n: GraphNode) => n.is_active;
    const searchFilter = (n: GraphNode) => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q);
    };

    const filteredNodes = graphData.nodes.filter(activeFilter).filter(searchFilter);
    
    // Merge new data with existing coordinates in simulation ref
    const merged = filteredNodes.map((n) => {
      const existing = simNodesRef.current.find((s) => s.id === n.id);
      if (existing) {
        return {
          ...n,
          x: existing.x,
          y: existing.y,
          vx: existing.vx,
          vy: existing.vy,
        };
      } else {
        // Spread near center
        const canvas = canvasRef.current;
        const cx = canvas ? canvas.width / 2 : 250;
        const cy = canvas ? canvas.height / 2 : 250;
        return {
          ...n,
          x: cx + (Math.random() - 0.5) * 150,
          y: cy + (Math.random() - 0.5) * 150,
          vx: 0,
          vy: 0,
        };
      }
    });

    simNodesRef.current = merged;
    
    // Update active selections if the node was tombstones or updated
    if (selectedNode) {
      const updated = merged.find((n) => n.id === selectedNode.id);
      if (updated) {
        setSelectedNode(updated);
      } else {
        setSelectedNode(null);
      }
    }
  }, [graphData, showHistory, searchQuery]);

  // Seeding sample network
  const handleSeedData = async () => {
    if (isWebMode) {
      addToast("Demo knowledge base re-seeded in Web mode!");
      // Reset mocks to defaults
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

  // Create pieces (plain, contact, calendar)
  const handleCreatePiece = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCollectionId) {
      addToast("Please select or create a collection first", "error");
      return;
    }

    let contentPayload = "";
    let titleStr = "";
    let metadataObj: Record<string, string> = {};

    if (activeTab === "text") {
      if (!noteContent.trim()) return;
      contentPayload = noteContent;
      const lines = noteContent.split("\n");
      titleStr = lines[0] ? lines[0].replace("#", "").trim() : "Untitled Note";
    } else if (activeTab === "contacts") {
      if (!contactFirst.trim() && !contactLast.trim()) return;
      const contactJson = {
        first_name: contactFirst ? contactFirst : undefined,
        last_name: contactLast ? contactLast : undefined,
        formatted_name: `${contactFirst} ${contactLast}`.trim(),
        email: contactEmail ? contactEmail : undefined,
        phone: contactPhone ? contactPhone : undefined,
        organization: contactOrg ? contactOrg : undefined,
        title: contactTitle ? contactTitle : undefined,
      };
      contentPayload = `Contact profile for ${contactJson.formatted_name}.`;
      titleStr = contactJson.formatted_name;
      metadataObj = {
        formatted_name: contactJson.formatted_name,
        email: contactEmail,
        phone: contactPhone,
        organization: contactOrg,
        title: contactTitle
      };
    } else if (activeTab === "calendar") {
      if (!eventSummary.trim()) return;
      contentPayload = `Calendar event: ${eventSummary}. Location: ${eventLoc}.`;
      titleStr = eventSummary;
      metadataObj = {
        summary: eventSummary,
        start_date: eventStart ? eventStart : new Date().toISOString(),
        end_date: eventEnd ? eventEnd : new Date(Date.now() + 3600000).toISOString(),
        location: eventLoc,
        description: eventDesc
      };
    }

    if (isWebMode) {
      const newPieceId = Math.random().toString(36).substring(2, 9);
      const newPiece: GraphNode = {
        id: newPieceId,
        collection_id: selectedCollectionId,
        uri: null,
        created_at: new Date().toISOString(),
        is_active: true,
        title: titleStr,
        content: activeTab === "text" ? noteContent : contentPayload,
        metadata: metadataObj
      };
      
      mockDbRef.current.nodes.push(newPiece);
      setGraphData({
        nodes: [...mockDbRef.current.nodes],
        edges: [...mockDbRef.current.edges],
        history_edges: [...mockDbRef.current.history_edges]
      });

      // Clear forms
      setNoteContent("");
      setContactFirst("");
      setContactLast("");
      setContactEmail("");
      setContactPhone("");
      setContactOrg("");
      setContactTitle("");
      setEventSummary("");
      setEventStart("");
      setEventEnd("");
      setEventDesc("");
      setEventLoc("");
      
      addToast("Piece created successfully in Web Mode!");
      return;
    }

    try {
      let rawPayload = "";
      if (activeTab === "text") {
        rawPayload = noteContent;
      } else {
        rawPayload = activeTab === "contacts" 
          ? JSON.stringify({
              first_name: contactFirst || undefined,
              last_name: contactLast || undefined,
              formatted_name: `${contactFirst} ${contactLast}`.trim(),
              email: contactEmail || undefined,
              phone: contactPhone || undefined,
              organization: contactOrg || undefined,
              title: contactTitle || undefined,
            })
          : JSON.stringify({
              summary: eventSummary,
              start_date: eventStart || new Date().toISOString(),
              end_date: eventEnd || new Date(Date.now() + 3600000).toISOString(),
              description: eventDesc || undefined,
              location: eventLoc || undefined,
            });
      }

      await invoke("create_piece", {
        collectionId: selectedCollectionId,
        content: rawPayload,
        pieceType: activeTab === "text" ? "text" : activeTab === "contacts" ? "contacts" : "calendar"
      });

      setNoteContent("");
      setContactFirst("");
      setContactLast("");
      setContactEmail("");
      setContactPhone("");
      setContactOrg("");
      setContactTitle("");
      setEventSummary("");
      setEventStart("");
      setEventEnd("");
      setEventDesc("");
      setEventLoc("");

      addToast("Piece ingested successfully!");
      await loadWorkspace();
    } catch (e: any) {
      addToast(String(e), "error");
    }
  };

  // Link pieces
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

  // Replace piece (edit operation)
  const handleReplacePiece = async () => {
    if (!selectedNode || !editText.trim()) return;

    if (isWebMode) {
      const newPieceId = Math.random().toString(36).substring(2, 9);
      
      // Tombstone old piece in memory
      const oldNode = mockDbRef.current.nodes.find((n) => n.id === selectedNode.id);
      if (oldNode) oldNode.is_active = false;
      
      // Determine title
      let titleStr = "Untitled";
      const lines = editText.split("\n");
      if (lines[0]) {
        titleStr = lines[0].replace("#", "").trim();
      }

      const newPiece: GraphNode = {
        id: newPieceId,
        collection_id: selectedNode.collection_id,
        uri: selectedNode.uri,
        created_at: new Date().toISOString(),
        is_active: true,
        title: titleStr,
        content: editText,
        metadata: { ...selectedNode.metadata }
      };

      mockDbRef.current.nodes.push(newPiece);
      mockDbRef.current.history_edges.push({
        parent: selectedNode.id,
        child: newPieceId,
        type: "replacement",
        timestamp: new Date().toISOString()
      });

      setGraphData({
        nodes: [...mockDbRef.current.nodes],
        edges: [...mockDbRef.current.edges],
        history_edges: [...mockDbRef.current.history_edges]
      });

      setIsEditing(false);
      setEditText("");
      setSelectedNode(newPiece);
      addToast("Replacement committed in Web Mode!");
      return;
    }

    try {
      addToast("Updating piece (creating replacement version)...");
      await invoke("replace_piece", {
        oldPieceId: selectedNode.id,
        content: editText,
      });
      setIsEditing(false);
      setEditText("");
      addToast("Piece replaced successfully! History linked.");
      await loadWorkspace();
    } catch (e: any) {
      addToast(String(e), "error");
    }
  };

  // Tombstone piece
  const handleTombstonePiece = async (id: string) => {
    if (!confirm("Are you sure you want to deactivate (tombstone) this piece? This will remove it from active vector queries.")) {
      return;
    }

    if (isWebMode) {
      const node = mockDbRef.current.nodes.find((n) => n.id === id);
      if (node) {
        node.is_active = false;
      }
      setGraphData({
        nodes: [...mockDbRef.current.nodes],
        edges: [...mockDbRef.current.edges],
        history_edges: [...mockDbRef.current.history_edges]
      });
      addToast("Piece tombstoned in Web Mode.");
      return;
    }

    try {
      await invoke("tombstone_piece", { pieceId: id });
      addToast("Piece tombstoned and deactivated.");
      await loadWorkspace();
    } catch (e: any) {
      addToast(String(e), "error");
    }
  };

  // Custom Physics Loop & Renderer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Handle canvas resizing
    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    // Physics parameters
    const repulsionStrength = 1000;
    const springStrength = 0.02;
    const linkLength = 120;
    const histLength = 60;
    const friction = 0.85;
    const centerPull = 0.008;

    const runPhysicsStep = () => {
      const nodes = simNodesRef.current;
      if (nodes.length === 0) return;

      const centerX = canvas.clientWidth / 2;
      const centerY = canvas.clientHeight / 2;

      // 1. Repulsion (Charge forces) between all pairs
      for (let i = 0; i < nodes.length; i++) {
        const n1 = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const n2 = nodes[j];
          let dx = (n2.x || 0) - (n1.x || 0);
          let dy = (n2.y || 0) - (n1.y || 0);
          let dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 1) dist = 1;

          if (dist < 300) {
            const force = -repulsionStrength / (dist * dist);
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;

            n1.vx = (n1.vx || 0) + fx;
            n1.vy = (n1.vy || 0) + fy;
            n2.vx = (n2.vx || 0) - fx;
            n2.vy = (n2.vy || 0) - fy;
          }
        }
      }

      // 2. Attraction along normal semantic relations
      graphData.edges.forEach((edge) => {
        const sourceNode = nodes.find((n) => n.id === edge.source);
        const targetNode = nodes.find((n) => n.id === edge.target);
        if (!sourceNode || !targetNode) return;

        const dx = (targetNode.x || 0) - (sourceNode.x || 0);
        const dy = (targetNode.y || 0) - (sourceNode.y || 0);
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) return;

        const force = springStrength * (dist - linkLength);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        sourceNode.vx = (sourceNode.vx || 0) + fx;
        sourceNode.vy = (sourceNode.vy || 0) + fy;
        targetNode.vx = (targetNode.vx || 0) - fx;
        targetNode.vy = (targetNode.vy || 0) - fy;
      });

      // 3. Attraction along history edges (drawn tighter)
      graphData.history_edges.forEach((edge) => {
        const parentNode = nodes.find((n) => n.id === edge.parent);
        const childNode = nodes.find((n) => n.id === edge.child);
        if (!parentNode || !childNode) return;

        const dx = (childNode.x || 0) - (parentNode.x || 0);
        const dy = (childNode.y || 0) - (parentNode.y || 0);
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) return;

        const force = springStrength * 1.5 * (dist - histLength);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        parentNode.vx = (parentNode.vx || 0) + fx;
        parentNode.vy = (parentNode.vy || 0) + fy;
        childNode.vx = (childNode.vx || 0) - fx;
        childNode.vy = (childNode.vy || 0) - fy;
      });

      // 4. Update coordinates + friction + central gravity pull
      nodes.forEach((n, idx) => {
        if (idx === draggedNodeIndex.current) {
          n.vx = 0;
          n.vy = 0;
          return; // Lock coordinates for dragged node
        }

        n.vx = ((n.vx || 0) + (centerX - (n.x || 0)) * centerPull) * friction;
        n.vy = ((n.vy || 0) + (centerY - (n.y || 0)) * centerPull) * friction;
        
        n.x = (n.x || 0) + n.vx;
        n.y = (n.y || 0) + n.vy;
      });
    };

    // Rendering Step
    const render = () => {
      const nodes = simNodesRef.current;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      
      ctx.clearRect(0, 0, w, h);
      
      ctx.save();
      ctx.translate(panRef.current.x, panRef.current.y);
      ctx.scale(zoomRef.current, zoomRef.current);

      // --- 1. Draw Edges ---
      graphData.edges.forEach((edge) => {
        const sourceNode = nodes.find((n) => n.id === edge.source);
        const targetNode = nodes.find((n) => n.id === edge.target);
        if (!sourceNode || !targetNode) return;

        ctx.beginPath();
        ctx.moveTo(sourceNode.x || 0, sourceNode.y || 0);
        ctx.lineTo(targetNode.x || 0, targetNode.y || 0);
        ctx.strokeStyle = "rgba(157, 78, 221, 0.4)";
        ctx.lineWidth = selectedNode && (selectedNode.id === sourceNode.id || selectedNode.id === targetNode.id) ? 3 : 1.5;
        ctx.stroke();

        if (zoomRef.current > 0.6) {
          const midX = ((sourceNode.x || 0) + (targetNode.x || 0)) / 2;
          const midY = ((sourceNode.y || 0) + (targetNode.y || 0)) / 2;
          ctx.font = "9px Inter";
          ctx.fillStyle = "rgba(148, 163, 184, 0.7)";
          ctx.textAlign = "center";
          ctx.fillText(edge.type, midX, midY - 4);
        }
      });

      graphData.history_edges.forEach((edge) => {
        const parentNode = nodes.find((n) => n.id === edge.parent);
        const childNode = nodes.find((n) => n.id === edge.child);
        if (!parentNode || !childNode) return;

        ctx.beginPath();
        ctx.setLineDash([4, 4]);
        ctx.moveTo(parentNode.x || 0, parentNode.y || 0);
        ctx.lineTo(childNode.x || 0, childNode.y || 0);
        ctx.strokeStyle = "rgba(148, 163, 184, 0.35)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]); // Reset line dash

        if (zoomRef.current > 0.5) {
          const px = parentNode.x || 0;
          const py = parentNode.y || 0;
          const cx = childNode.x || 0;
          const cy = childNode.y || 0;
          const dx = cx - px;
          const dy = cy - py;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 25) {
            const targetX = cx - (dx / dist) * 20;
            const targetY = cy - (dy / dist) * 20;
            const angle = Math.atan2(dy, dx);
            ctx.beginPath();
            ctx.moveTo(targetX, targetY);
            ctx.lineTo(
              targetX - 8 * Math.cos(angle - Math.PI / 6),
              targetY - 8 * Math.sin(angle - Math.PI / 6)
            );
            ctx.lineTo(
              targetX - 8 * Math.cos(angle + Math.PI / 6),
              targetY - 8 * Math.sin(angle + Math.PI / 6)
            );
            ctx.closePath();
            ctx.fillStyle = "rgba(148, 163, 184, 0.4)";
            ctx.fill();
          }
        }
      });

      // --- 2. Draw Nodes ---
      nodes.forEach((n, idx) => {
        const radius = 20;
        const x = n.x || 0;
        const y = n.y || 0;
        const isHovered = idx === hoveredNodeIndex.current;
        const isSelected = selectedNode && selectedNode.id === n.id;
        
        let accent = "#9d4edd";
        let accentGlow = "rgba(157, 78, 221, 0.25)";
        let letter = "N";
        
        const col = collections.find((c) => c.id === n.collection_id);
        if (col) {
          if (col.type === "contacts") {
            accent = "#00f5d4";
            accentGlow = "rgba(0, 245, 212, 0.25)";
            letter = "C";
          } else if (col.type === "calendar") {
            accent = "#ff9f1c";
            accentGlow = "rgba(255, 159, 28, 0.25)";
            letter = "E";
          }
        }

        if (n.is_active && (isHovered || isSelected)) {
          ctx.beginPath();
          ctx.arc(x, y, radius + 6, 0, Math.PI * 2);
          ctx.fillStyle = accentGlow;
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        
        if (!n.is_active) {
          ctx.fillStyle = "rgba(20, 22, 33, 0.6)";
          ctx.fill();
          ctx.strokeStyle = "rgba(100, 116, 139, 0.5)";
          ctx.setLineDash([3, 3]);
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.setLineDash([]);
        } else {
          ctx.fillStyle = "rgba(17, 19, 28, 0.95)";
          ctx.fill();
          ctx.strokeStyle = isSelected ? "#fff" : accent;
          ctx.lineWidth = isSelected ? 3.0 : 1.8;
          ctx.stroke();
        }

        ctx.font = "bold 12px Inter";
        ctx.fillStyle = !n.is_active ? "rgba(100, 116, 139, 0.6)" : accent;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(letter, x, y);

        if (zoomRef.current > 0.45 || isHovered || isSelected) {
          ctx.font = isSelected ? "bold 11px Inter" : "10px Inter";
          ctx.fillStyle = isSelected 
            ? "#ffffff" 
            : !n.is_active 
              ? "rgba(100, 116, 139, 0.6)" 
              : "rgba(241, 243, 249, 0.95)";
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          
          let lbl = n.title;
          if (lbl.length > 20) {
            lbl = lbl.substring(0, 17) + "...";
          }
          ctx.fillText(lbl, x, y + radius + 6);
        }
      });

      ctx.restore();
    };

    const loop = () => {
      runPhysicsStep();
      render();
      animationFrameId.current = requestAnimationFrame(loop);
    };

    animationFrameId.current = requestAnimationFrame(loop);

    return () => {
      window.removeEventListener("resize", resizeCanvas);
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };
  }, [graphData, selectedNode, collections]);

  // Interactive mouse canvas triggers
  const getMousePos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    return {
      x: (mx - pan.x) / zoom,
      y: (my - pan.y) / zoom,
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const mPos = getMousePos(e);
    const nodes = simNodesRef.current;
    
    let clickedNodeIdx = -1;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const dx = (n.x || 0) - mPos.x;
      const dy = (n.y || 0) - mPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 22) {
        clickedNodeIdx = i;
        break;
      }
    }

    if (clickedNodeIdx !== -1) {
      draggedNodeIndex.current = clickedNodeIdx;
      setSelectedNode(nodes[clickedNodeIdx]);
      setIsEditing(false);
      setEditText("");
      
      if (!sourceNodeId) {
        setSourceNodeId(nodes[clickedNodeIdx].id);
      } else if (sourceNodeId && sourceNodeId !== nodes[clickedNodeIdx].id) {
        setTargetNodeId(nodes[clickedNodeIdx].id);
      }
    } else {
      isDraggingCanvas.current = true;
      dragStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const nodes = simNodesRef.current;
    
    if (draggedNodeIndex.current !== null) {
      const mPos = getMousePos(e);
      const idx = draggedNodeIndex.current;
      if (nodes[idx]) {
        nodes[idx].x = mPos.x;
        nodes[idx].y = mPos.y;
      }
    } else if (isDraggingCanvas.current) {
      setPan({
        x: e.clientX - dragStart.current.x,
        y: e.clientY - dragStart.current.y,
      });
    } else {
      const mPos = getMousePos(e);
      let hoverIdx = -1;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const dx = (n.x || 0) - mPos.x;
        const dy = (n.y || 0) - mPos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 22) {
          hoverIdx = i;
          break;
        }
      }
      hoveredNodeIndex.current = hoverIdx !== -1 ? hoverIdx : null;
    }
  };

  const handleMouseUp = () => {
    draggedNodeIndex.current = null;
    isDraggingCanvas.current = false;
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const zoomIntensity = 0.05;
    e.preventDefault();
    
    const zoomFactor = e.deltaY < 0 ? (1 + zoomIntensity) : (1 - zoomIntensity);
    const newZoom = Math.min(Math.max(zoom * zoomFactor, 0.15), 4.0);
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    
    const dx = mx - pan.x;
    const dy = my - pan.y;
    
    setPan({
      x: mx - dx * (newZoom / zoom),
      y: my - dy * (newZoom / zoom),
    });
    setZoom(newZoom);
  };

  const getColName = (colId: string) => {
    const col = collections.find((c) => c.id === colId);
    return col ? col.name : "Unknown Collection";
  };

  const handleEditClick = () => {
    if (!selectedNode) return;
    setIsEditing(true);
    setEditText(selectedNode.content);
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

      {/* LEFT SIDEBAR: Forms and collection list */}
      <aside className="glass-panel left-sidebar">
        <header className="panel-header">
          <h2>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
            vibeNote
          </h2>
          <p>Local PKM Semantic Engine {isWebMode && " (Web Demo)"}</p>

          {activeVibePath && (
            <div className="workspace-info-box">
              <span className="workspace-label" title={activeVibePath}>
                Vibe: <code>{activeVibePath.length > 25 ? "..." + activeVibePath.substring(activeVibePath.length - 22) : activeVibePath}</code>
              </span>
              {!isWebMode && (
                <button className="btn-icon" title="Switch Vibe" onClick={() => setShowWorkspaceOverlay(true)} style={{ background: "none", border: "none", color: "var(--primary-glow)", cursor: "pointer", display: "inline-flex", alignItems: "center", marginLeft: "6px" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
                  </svg>
                </button>
              )}
            </div>
          )}
        </header>

        <div className="panel-content">
          {/* Workspace Collections */}
          <div>
            <h4 className="panel-section-title">Collections</h4>
            {collections.length === 0 ? (
              <p style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>No collections loaded.</p>
            ) : (
              collections.map((col) => (
                <div key={col.id} className="collection-item">
                  <span>{col.name}</span>
                  <span className={`badge-type ${col.type}`}>{col.type}</span>
                </div>
              ))
            )}
            <button className="btn btn-secondary btn-block" style={{ marginTop: "10px" }} onClick={handleSeedData}>
              Seed Demo Knowledge Base
            </button>
          </div>

          {/* Creation Hub */}
          <div>
            <h4 className="panel-section-title">Ingest New Piece hub</h4>
            
            <div style={{ display: "flex", gap: "4px", marginBottom: "16px", background: "rgba(0,0,0,0.2)", padding: "4px", borderRadius: "8px" }}>
              <button 
                id="tab-note"
                className={`btn btn-secondary ${activeTab === "text" ? "btn-primary" : ""}`}
                style={{ flex: 1, padding: "6px 8px", fontSize: "0.75rem" }}
                onClick={() => setActiveTab("text")}
              >
                Note
              </button>
              <button 
                id="tab-contact"
                className={`btn btn-secondary ${activeTab === "contacts" ? "btn-primary" : ""}`}
                style={{ flex: 1, padding: "6px 8px", fontSize: "0.75rem" }}
                onClick={() => setActiveTab("contacts")}
              >
                Contact
              </button>
              <button 
                id="tab-event"
                className={`btn btn-secondary ${activeTab === "calendar" ? "btn-primary" : ""}`}
                style={{ flex: 1, padding: "6px 8px", fontSize: "0.75rem" }}
                onClick={() => setActiveTab("calendar")}
              >
                Event
              </button>
            </div>

            <form onSubmit={handleCreatePiece}>
              <div className="form-group">
                <label>Target Collection</label>
                <select 
                  id="target-collection"
                  className="form-control"
                  value={selectedCollectionId}
                  onChange={(e) => setSelectedCollectionId(e.target.value)}
                >
                  <option value="">-- Choose Collection --</option>
                  {collections
                    .filter((c) => c.type === activeTab)
                    .map((col) => (
                      <option key={col.id} value={col.id}>{col.name}</option>
                    ))
                  }
                </select>
              </div>

              {activeTab === "text" && (
                <div className="form-group">
                  <label>Note Content (Markdown)</label>
                  <textarea 
                    id="note-content"
                    className="form-control"
                    placeholder="# Heading&#10;Write note content here..."
                    value={noteContent}
                    onChange={(e) => setNoteContent(e.target.value)}
                  />
                </div>
              )}

              {activeTab === "contacts" && (
                <>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <div className="form-group" style={{ flex: 1 }}>
                      <label>First Name</label>
                      <input id="contact-first" className="form-control" value={contactFirst} onChange={(e) => setContactFirst(e.target.value)} placeholder="John" />
                    </div>
                    <div className="form-group" style={{ flex: 1 }}>
                      <label>Last Name</label>
                      <input id="contact-last" className="form-control" value={contactLast} onChange={(e) => setContactLast(e.target.value)} placeholder="Doe" />
                    </div>
                  </div>
                  <div className="form-group">
                    <label>Email Address</label>
                    <input id="contact-email" className="form-control" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="john@company.com" />
                  </div>
                  <div className="form-group">
                    <label>Phone Number</label>
                    <input id="contact-phone" className="form-control" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="+1-555-0100" />
                  </div>
                  <div className="form-group">
                    <label>Organization</label>
                    <input id="contact-org" className="form-control" value={contactOrg} onChange={(e) => setContactOrg(e.target.value)} placeholder="Acme Inc." />
                  </div>
                  <div className="form-group">
                    <label>Job Title</label>
                    <input id="contact-title" className="form-control" value={contactTitle} onChange={(e) => setContactTitle(e.target.value)} placeholder="Software Director" />
                  </div>
                </>
              )}

              {activeTab === "calendar" && (
                <>
                  <div className="form-group">
                    <label>Event Summary (Title)</label>
                    <input id="event-summary" className="form-control" value={eventSummary} onChange={(e) => setEventSummary(e.target.value)} placeholder="Design Review Session" />
                  </div>
                  <div className="form-group">
                    <label>Start Date & Time</label>
                    <input id="event-start" className="form-control" type="datetime-local" value={eventStart} onChange={(e) => setEventStart(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>End Date & Time</label>
                    <input id="event-end" className="form-control" type="datetime-local" value={eventEnd} onChange={(e) => setEventEnd(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>Location</label>
                    <input id="event-loc" className="form-control" value={eventLoc} onChange={(e) => setEventLoc(e.target.value)} placeholder="Zoom Meeting Room" />
                  </div>
                  <div className="form-group">
                    <label>Description</label>
                    <textarea id="event-desc" className="form-control" value={eventDesc} onChange={(e) => setEventDesc(e.target.value)} placeholder="Sync meeting to discuss roadmap..." />
                  </div>
                </>
              )}

              <button id="btn-ingest" className="btn btn-primary btn-block" type="submit">
                Ingest Piece
              </button>
            </form>
          </div>

          {/* Relation Builder */}
          <div>
            <h4 className="panel-section-title">Link Pieces</h4>
            <form onSubmit={handleCreateRelation}>
              <div className="form-group">
                <label>Source Piece ID / Selected</label>
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
                <label>Target Piece ID / Selected</label>
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
                <label>Relation Tag</label>
                <select id="link-type" className="form-control" value={relationType} onChange={(e) => setRelationType(e.target.value)}>
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
        </div>
      </aside>

      {/* CENTER WORKSPACE: Interactive 2D Graph Visualizer */}
      <section className="workspace-center">
        {/* Floating Top Header Options */}
        <div className="top-controls-bar">
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
        <div className="graph-legend">
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
          <canvas 
            id="graph-viewport-canvas"
            ref={canvasRef} 
            className="graph-canvas"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
          />
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
          {!selectedNode ? (
            <div className="empty-state" style={{ height: "100%", padding: "20px" }}>
              <p>Click a node in the graph workspace to inspect its properties, view revision logs, or create an immutable edit replacement version.</p>
            </div>
          ) : (
            <div className="node-inspector">
              
              <div className="inspector-header">
                <div className="inspector-title" id="inspector-node-title">{selectedNode.title}</div>
                <div className={`badge-status ${selectedNode.is_active ? "active" : "inactive"}`} id="inspector-node-status">
                  {selectedNode.is_active ? "active" : "tombstoned"}
                </div>
              </div>

              {/* Core Metadata */}
              <div className="metadata-grid">
                <div className="metadata-label">Piece ID</div>
                <div className="metadata-value" id="inspector-node-id" style={{ fontFamily: "monospace" }}>{selectedNode.id}</div>
                
                <div className="metadata-label">Collection</div>
                <div className="metadata-value" id="inspector-node-collection">{getColName(selectedNode.collection_id)}</div>

                <div className="metadata-label">Created</div>
                <div className="metadata-value" id="inspector-node-created">{new Date(selectedNode.created_at).toLocaleString()}</div>

                {Object.entries(selectedNode.metadata).map(([key, val]) => (
                  <React.Fragment key={key}>
                    <div className="metadata-label">{key}</div>
                    <div className="metadata-value">{val}</div>
                  </React.Fragment>
                ))}
              </div>

              {/* Content Preview/Editor */}
              <div className="panel-section-title">Raw Content</div>
              {isEditing ? (
                <div className="form-group" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                  <textarea 
                    id="edit-content-textarea"
                    className="form-control" 
                    style={{ flex: 1, minHeight: "200px" }}
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                  />
                  <div className="edit-actions-container" style={{ marginTop: "12px", marginBottom: "16px" }}>
                    <button id="btn-commit-edit" className="btn btn-primary" style={{ flex: 1 }} onClick={handleReplacePiece}>
                      Commit Replacement
                    </button>
                    <button id="btn-cancel-edit" className="btn btn-secondary" onClick={() => setIsEditing(false)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="content-preview-container" id="inspector-node-content">
                    {selectedNode.content}
                  </div>

                  {selectedNode.is_active && (
                    <div className="edit-actions-container">
                      <button id="btn-edit-node" className="btn btn-primary" style={{ flex: 1 }} onClick={handleEditClick}>
                        Create Replacement (Edit)
                      </button>
                      <button id="btn-tombstone-node" className="btn btn-danger" onClick={() => handleTombstonePiece(selectedNode.id)}>
                        Tombstone
                      </button>
                    </div>
                  )}
                </>
              )}

            </div>
          )}
        </div>
      </aside>

    </div>
  );
}

export default App;
