export interface Collection {
  id: string;
  name: string;
  type: "text" | "contacts" | "calendar";
  folder_path: string;
}

export interface GraphNode {
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

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
  created_at: string;
}

export interface HistoryEdge {
  parent: string;
  child: string;
  type: "replacement" | "extension";
  timestamp: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  history_edges: HistoryEdge[];
}

export interface Toast {
  id: string;
  message: string;
  type: "success" | "error";
}
