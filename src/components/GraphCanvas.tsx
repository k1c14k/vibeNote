import React, { useEffect, useRef } from "react";
import { Collection, GraphNode, GraphData } from "../types";

interface GraphCanvasProps {
  graphData: GraphData;
  collections: Collection[];
  theme: "dark" | "light";
  selectedNode: GraphNode | null;
  setSelectedNode: (node: GraphNode | null) => void;
  searchQuery: string;
  showHistory: boolean;
  selectedBrowseCollectionId: string;
  sourceNodeId: string;
  setSourceNodeId: (id: string) => void;
  targetNodeId: string;
  setTargetNodeId: (id: string) => void;
  zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  pan: { x: number; y: number };
  setPan: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>;
  nodeIdToCenter: string | null;
  setNodeIdToCenter: (id: string | null) => void;
}

export const GraphCanvas: React.FC<GraphCanvasProps> = ({
  graphData,
  collections,
  theme,
  selectedNode,
  setSelectedNode,
  searchQuery,
  showHistory,
  selectedBrowseCollectionId,
  sourceNodeId,
  setSourceNodeId,
  setTargetNodeId,
  zoom,
  setZoom,
  pan,
  setPan,
  nodeIdToCenter,
  setNodeIdToCenter,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simNodesRef = useRef<GraphNode[]>([]);
  const animationFrameId = useRef<number | null>(null);

  // Mouse interaction state refs
  const isDraggingCanvas = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const draggedNodeIndex = useRef<number | null>(null);
  const hoveredNodeIndex = useRef<number | null>(null);

  // Refs for tracking pan & zoom in callback loops
  const panRef = useRef(pan);
  const zoomRef = useRef(zoom);

  // Centering viewport on a node when triggered by external controls
  useEffect(() => {
    if (!nodeIdToCenter) return;
    const node = simNodesRef.current.find((n) => n.id === nodeIdToCenter);
    if (node) {
      setSelectedNode(node);
      const canvas = canvasRef.current;
      if (canvas && typeof node.x === "number" && typeof node.y === "number") {
        const W = canvas.clientWidth;
        const H = canvas.clientHeight;
        const targetZoom = 1.2;
        setZoom(targetZoom);
        setPan({
          x: W / 2 - node.x * targetZoom,
          y: H / 2 - node.y * targetZoom,
        });
      }
    }
    setNodeIdToCenter(null);
  }, [nodeIdToCenter]);

  useEffect(() => {
    panRef.current = pan;
  }, [pan]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  // Update simulation nodes when database or filter parameters change
  useEffect(() => {
    const activeFilter = showHistory ? () => true : (n: GraphNode) => n.is_active;
    const searchFilter = (n: GraphNode) => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q);
    };
    const collectionFilter = (n: GraphNode) => {
      if (!selectedBrowseCollectionId) return true;
      return n.collection_id === selectedBrowseCollectionId;
    };

    const filteredNodes = graphData.nodes
      .filter(activeFilter)
      .filter(searchFilter)
      .filter(collectionFilter);

    // Merge coordinates
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

    if (selectedNode) {
      const updated = merged.find((n) => n.id === selectedNode.id);
      if (updated) {
        setSelectedNode(updated);
      } else {
        setSelectedNode(null);
      }
    }
  }, [graphData, showHistory, searchQuery, selectedBrowseCollectionId]);

  // Physics Loop & Renderer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    // Physics constants
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

      // 1. Repulsion
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

      // 2. Semantic Attraction
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

      // 3. History Attraction
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

      // 4. Central Pull + Friction update
      nodes.forEach((n, idx) => {
        if (idx === draggedNodeIndex.current) {
          n.vx = 0;
          n.vy = 0;
          return;
        }

        n.vx = ((n.vx || 0) + (centerX - (n.x || 0)) * centerPull) * friction;
        n.vy = ((n.vy || 0) + (centerY - (n.y || 0)) * centerPull) * friction;

        n.x = (n.x || 0) + n.vx;
        n.y = (n.y || 0) + n.vy;
      });
    };

    const render = () => {
      const nodes = simNodesRef.current;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;

      ctx.clearRect(0, 0, w, h);

      ctx.save();
      ctx.translate(panRef.current.x, panRef.current.y);
      ctx.scale(zoomRef.current, zoomRef.current);

      // 1. Draw Edges
      graphData.edges.forEach((edge) => {
        const sourceNode = nodes.find((n) => n.id === edge.source);
        const targetNode = nodes.find((n) => n.id === edge.target);
        if (!sourceNode || !targetNode) return;

        ctx.beginPath();
        ctx.moveTo(sourceNode.x || 0, sourceNode.y || 0);
        ctx.lineTo(targetNode.x || 0, targetNode.y || 0);
        ctx.strokeStyle = theme === "light" ? "rgba(123, 44, 191, 0.35)" : "rgba(157, 78, 221, 0.4)";
        ctx.lineWidth = selectedNode && (selectedNode.id === sourceNode.id || selectedNode.id === targetNode.id) ? 3 : 1.5;
        ctx.stroke();

        if (zoomRef.current > 0.6) {
          const midX = ((sourceNode.x || 0) + (targetNode.x || 0)) / 2;
          const midY = ((sourceNode.y || 0) + (targetNode.y || 0)) / 2;
          ctx.font = "9px Inter";
          ctx.fillStyle = theme === "light" ? "rgba(71, 85, 105, 0.75)" : "rgba(148, 163, 184, 0.7)";
          ctx.textAlign = "center";
          ctx.fillText(edge.type, midX, midY - 4);
        }
      });

      // Draw History Edges
      graphData.history_edges.forEach((edge) => {
        const parentNode = nodes.find((n) => n.id === edge.parent);
        const childNode = nodes.find((n) => n.id === edge.child);
        if (!parentNode || !childNode) return;

        ctx.beginPath();
        ctx.setLineDash([4, 4]);
        ctx.moveTo(parentNode.x || 0, parentNode.y || 0);
        ctx.lineTo(childNode.x || 0, childNode.y || 0);
        ctx.strokeStyle = theme === "light" ? "rgba(148, 163, 184, 0.5)" : "rgba(148, 163, 184, 0.35)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);

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
            ctx.fillStyle = theme === "light" ? "rgba(148, 163, 184, 0.55)" : "rgba(148, 163, 184, 0.4)";
            ctx.fill();
          }
        }
      });

      // 2. Draw Nodes
      nodes.forEach((n, idx) => {
        const radius = 20;
        const x = n.x || 0;
        const y = n.y || 0;
        const isHovered = idx === hoveredNodeIndex.current;
        const isSelected = selectedNode && selectedNode.id === n.id;

        let accent = theme === "light" ? "#7b2cbf" : "#9d4edd";
        let accentGlow = theme === "light" ? "rgba(123, 44, 191, 0.2)" : "rgba(157, 78, 221, 0.25)";
        let letter = "N";

        const col = collections.find((c) => c.id === n.collection_id);
        if (col) {
          if (col.type === "contacts") {
            accent = theme === "light" ? "#00b4d8" : "#00f5d4";
            accentGlow = theme === "light" ? "rgba(0, 180, 216, 0.2)" : "rgba(0, 245, 212, 0.25)";
            letter = "C";
          } else if (col.type === "calendar") {
            accent = theme === "light" ? "#f77f00" : "#ff9f1c";
            accentGlow = theme === "light" ? "rgba(247, 127, 0, 0.2)" : "rgba(255, 159, 28, 0.25)";
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
          ctx.fillStyle = theme === "light" ? "rgba(241, 245, 249, 0.6)" : "rgba(20, 22, 33, 0.6)";
          ctx.fill();
          ctx.strokeStyle = theme === "light" ? "rgba(148, 163, 184, 0.5)" : "rgba(100, 116, 139, 0.5)";
          ctx.setLineDash([3, 3]);
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.setLineDash([]);
        } else {
          ctx.fillStyle = theme === "light" ? "rgba(255, 255, 255, 0.95)" : "rgba(17, 19, 28, 0.95)";
          ctx.fill();
          ctx.strokeStyle = isSelected ? (theme === "light" ? "#0f172a" : "#fff") : accent;
          ctx.lineWidth = isSelected ? 3.0 : 1.8;
          ctx.stroke();
        }

        ctx.font = "bold 12px Inter";
        ctx.fillStyle = !n.is_active ? (theme === "light" ? "rgba(148, 163, 184, 0.7)" : "rgba(100, 116, 139, 0.6)") : accent;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(letter, x, y);

        if (zoomRef.current > 0.45 || isHovered || isSelected) {
          ctx.font = isSelected ? "bold 11px Inter" : "10px Inter";
          ctx.fillStyle = isSelected
            ? (theme === "light" ? "#0f172a" : "#ffffff")
            : !n.is_active
              ? (theme === "light" ? "rgba(148, 163, 184, 0.7)" : "rgba(100, 116, 139, 0.6)")
              : (theme === "light" ? "rgba(15, 23, 42, 0.95)" : "rgba(241, 243, 249, 0.95)");
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
  }, [graphData, selectedNode, collections, theme]);

  // Mouse Coordinates Utilities
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

  return (
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
  );
};
export default GraphCanvas;
