import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Collection, GraphNode } from "../types";

interface InspectorPanelProps {
  selectedNode: GraphNode | null;
  setSelectedNode: (node: GraphNode | null) => void;
  collections: Collection[];
  isWebMode: boolean;
  addToast: (msg: string, type?: "success" | "error") => void;
  loadWorkspace: () => Promise<void>;
  onReplaceMockPiece: (oldId: string, newPiece: GraphNode) => void;
  onTombstoneMockPiece: (id: string) => void;
}

export const InspectorPanel: React.FC<InspectorPanelProps> = ({
  selectedNode,
  setSelectedNode,
  collections,
  isWebMode,
  addToast,
  loadWorkspace,
  onReplaceMockPiece,
  onTombstoneMockPiece,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState("");

  // Edit states for contacts
  const [editContactFirst, setEditContactFirst] = useState("");
  const [editContactLast, setEditContactLast] = useState("");
  const [editContactEmail, setEditContactEmail] = useState("");
  const [editContactPhone, setEditContactPhone] = useState("");
  const [editContactOrg, setEditContactOrg] = useState("");
  const [editContactTitle, setEditContactTitle] = useState("");

  // Edit states for calendar events
  const [editEventSummary, setEditEventSummary] = useState("");
  const [editEventStart, setEditEventStart] = useState("");
  const [editEventEnd, setEditEventEnd] = useState("");
  const [editEventDesc, setEditEventDesc] = useState("");
  const [editEventLoc, setEditEventLoc] = useState("");

  const [showEditPreview, setShowEditPreview] = useState(false);

  // Sync edit fields whenever the selected node changes
  useEffect(() => {
    setIsEditing(false);
    setEditText("");
    setShowEditPreview(false);
  }, [selectedNode]);

  if (!selectedNode) {
    return (
      <div className="empty-state" style={{ height: "100%", padding: "20px" }}>
        <p>Click a node in the graph workspace to inspect its properties, view revision logs, or create an immutable edit replacement version.</p>
      </div>
    );
  }

  const getColName = (colId: string) => {
    const col = collections.find((c) => c.id === colId);
    return col ? col.name : "Unknown Collection";
  };

  const getColType = (colId: string) => {
    const col = collections.find((c) => c.id === colId);
    return col ? col.type : "text";
  };

  const handleEditClick = () => {
    setIsEditing(true);
    const colType = getColType(selectedNode.collection_id);

    if (colType === "text") {
      setEditText(selectedNode.content);
    } else if (colType === "contacts") {
      const vcard = selectedNode.content;
      const getField = (regex: RegExp) => {
        const m = vcard.match(regex);
        return m ? m[1].trim() : "";
      };

      const nMatch = vcard.match(/^N:([^;]*);([^;]*)/m);
      const lastName = nMatch ? nMatch[1] : "";
      const firstName = nMatch ? nMatch[2] : "";

      setEditContactFirst(firstName || selectedNode.metadata.first_name || "");
      setEditContactLast(lastName || selectedNode.metadata.last_name || "");
      setEditContactEmail(selectedNode.metadata.email || getField(/^EMAIL(?:;[^:]*)?:(.*)$/m));
      setEditContactPhone(selectedNode.metadata.phone || getField(/^TEL(?:;[^:]*)?:(.*)$/m));
      setEditContactOrg(selectedNode.metadata.organization || getField(/^ORG:(.*)$/m));
      setEditContactTitle(selectedNode.metadata.title || getField(/^TITLE:(.*)$/m));
    } else if (colType === "calendar") {
      const ical = selectedNode.content;
      const getField = (regex: RegExp) => {
        const m = ical.match(regex);
        return m ? m[1].trim() : "";
      };

      const parseIcalDate = (raw: string) => {
        if (!raw) return "";
        const clean = raw.trim();
        if (clean.length >= 15) {
          const y = clean.substring(0, 4);
          const m = clean.substring(4, 6);
          const d = clean.substring(6, 8);
          const h = clean.substring(9, 11);
          const min = clean.substring(11, 13);
          return `${y}-${m}-${d}T${h}:${min}`;
        }
        if (clean.includes("T") && clean.includes("-")) {
          return clean.substring(0, 16);
        }
        return clean;
      };

      setEditEventSummary(selectedNode.metadata.summary || getField(/^SUMMARY:(.*)$/m));
      setEditEventStart(parseIcalDate(selectedNode.metadata.start_date || getField(/^DTSTART:(.*)$/m)));
      setEditEventEnd(parseIcalDate(selectedNode.metadata.end_date || getField(/^DTEND:(.*)$/m)));
      setEditEventDesc(selectedNode.metadata.description || getField(/^DESCRIPTION:(.*)$/m));
      setEditEventLoc(selectedNode.metadata.location || getField(/^LOCATION:(.*)$/m));
    }
  };

  const handleReplacePiece = async () => {
    let contentToSubmit = "";
    const colType = getColType(selectedNode.collection_id);

    if (colType === "text") {
      if (!editText.trim()) return;
      contentToSubmit = editText;
    } else if (colType === "contacts") {
      const contactObj = {
        first_name: editContactFirst || null,
        last_name: editContactLast || null,
        formatted_name: `${editContactFirst} ${editContactLast}`.trim() || "Unnamed Contact",
        email: editContactEmail || null,
        phone: editContactPhone || null,
        organization: editContactOrg || null,
        title: editContactTitle || null,
      };
      contentToSubmit = JSON.stringify(contactObj);
    } else if (colType === "calendar") {
      if (!editEventSummary.trim()) {
        addToast("Event summary is required", "error");
        return;
      }
      const formatIso = (val: string) => {
        if (!val) return "";
        return val.includes("Z") ? val : `${val}:00Z`;
      };
      const eventObj = {
        summary: editEventSummary,
        start_date: formatIso(editEventStart),
        end_date: formatIso(editEventEnd),
        description: editEventDesc || null,
        location: editEventLoc || null,
      };
      contentToSubmit = JSON.stringify(eventObj);
    }

    if (isWebMode) {
      const newPieceId = Math.random().toString(36).substring(2, 9);
      let titleStr = "Untitled";
      let metadataObj = { ...selectedNode.metadata };

      if (colType === "text") {
        const lines = contentToSubmit.split("\n");
        if (lines[0]) {
          titleStr = lines[0].replace("#", "").trim();
        }
      } else if (colType === "contacts") {
        const parsed = JSON.parse(contentToSubmit);
        titleStr = parsed.formatted_name;
        metadataObj = {
          formatted_name: parsed.formatted_name,
          first_name: parsed.first_name || "",
          last_name: parsed.last_name || "",
          email: parsed.email || "",
          phone: parsed.phone || "",
          organization: parsed.organization || "",
          title: parsed.title || "",
        };
      } else if (colType === "calendar") {
        const parsed = JSON.parse(contentToSubmit);
        titleStr = parsed.summary;
        metadataObj = {
          summary: parsed.summary,
          start_date: parsed.start_date,
          end_date: parsed.end_date,
          description: parsed.description || "",
          location: parsed.location || "",
        };
      }

      const newPiece: GraphNode = {
        id: newPieceId,
        collection_id: selectedNode.collection_id,
        uri: selectedNode.uri,
        created_at: new Date().toISOString(),
        is_active: true,
        title: titleStr,
        content: contentToSubmit,
        metadata: metadataObj,
      };

      onReplaceMockPiece(selectedNode.id, newPiece);
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
        content: contentToSubmit,
      });
      setIsEditing(false);
      setEditText("");
      addToast("Piece replaced successfully! History linked.");
      await loadWorkspace();
    } catch (e: any) {
      addToast(String(e), "error");
    }
  };

  const handleTombstonePiece = async (id: string) => {
    if (!confirm("Are you sure you want to deactivate (tombstone) this piece? This will remove it from active vector queries.")) {
      return;
    }

    if (isWebMode) {
      onTombstoneMockPiece(id);
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

  const renderMarkdown = (text: string) => {
    if (!text) return null;
    let html = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Headings
    html = html.replace(/^### (.*?)$/gm, "<h3>$1</h3>");
    html = html.replace(/^## (.*?)$/gm, "<h2>$1</h2>");
    html = html.replace(/^# (.*?)$/gm, "<h1>$1</h1>");

    // Bullet lists
    const lines = html.split("\n");
    let inList = false;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
        lines[i] = `<li>${trimmed.substring(2)}</li>`;
        if (!inList) {
          lines[i] = `<ul>${lines[i]}`;
          inList = true;
        }
      } else {
        if (inList) {
          lines[i - 1] = `${lines[i - 1]}</ul>`;
          inList = false;
        }
      }
    }
    if (inList) {
      lines[lines.length - 1] = `${lines[lines.length - 1]}</ul>`;
    }
    html = lines.join("\n");

    // Bold, Italics, Code
    html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*(.*?)\*/g, "<em>$1</em>");
    html = html.replace(/`(.*?)`/g, "<code>$1</code>");

    // Line breaks
    html = html.split("\n").map(line => {
      const t = line.trim();
      if (t.startsWith("<h") || t.startsWith("<ul") || t.startsWith("<li") || t.startsWith("</ul")) {
        return line;
      }
      return line ? `<p>${line}</p>` : "";
    }).join("");

    return <div dangerouslySetInnerHTML={{ __html: html }} className="markdown-body" />;
  };

  const renderContactCard = (node: GraphNode) => {
    const fn = node.metadata.formatted_name || "Unnamed Contact";
    const initials = fn.split(" ").map((w: string) => w[0]).join("").substring(0, 2).toUpperCase() || "?";
    return (
      <div className="contact-card animate-scale-up">
        <div className="contact-card-header">
          <div className="contact-avatar">{initials}</div>
          <div className="contact-header-info">
            <h3>{fn}</h3>
            <p className="contact-title-text">{node.metadata.title || "No Title"}</p>
            <p className="contact-org-text">{node.metadata.organization || "No Organization"}</p>
          </div>
        </div>
        <div className="contact-card-body">
          {node.metadata.email && (
            <div className="contact-info-row">
              <span className="icon">✉</span>
              <span className="value">{node.metadata.email}</span>
            </div>
          )}
          {node.metadata.phone && (
            <div className="contact-info-row">
              <span className="icon">📞</span>
              <span className="value">{node.metadata.phone}</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderCalendarCard = (node: GraphNode) => {
    const formatEventDate = (isoStr: string) => {
      if (!isoStr) return "";
      try {
        const d = new Date(isoStr);
        return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
      } catch {
        return isoStr;
      }
    };

    let day = "1";
    let month = "JAN";
    if (node.metadata.start_date) {
      try {
        const d = new Date(node.metadata.start_date);
        day = d.getDate().toString();
        month = d.toLocaleString("default", { month: "short" }).toUpperCase();
      } catch {}
    }

    return (
      <div className="event-card animate-scale-up">
        <div className="event-card-header">
          <div className="calendar-icon-badge">
            <span className="month">{month}</span>
            <span className="day">{day}</span>
          </div>
          <div className="event-header-info">
            <h3>{node.metadata.summary || "Untitled Event"}</h3>
            <p className="event-time">{formatEventDate(node.metadata.start_date)} - {formatEventDate(node.metadata.end_date)}</p>
          </div>
        </div>
        <div className="event-card-body">
          {node.metadata.location && (
            <div className="event-info-row">
              <span className="icon">📍</span>
              <span className="value">{node.metadata.location}</span>
            </div>
          )}
          {node.metadata.description && (
            <div className="event-description">
              <p>{node.metadata.description}</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  const colType = getColType(selectedNode.collection_id);

  return (
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

        {Object.entries(selectedNode.metadata)
          .filter(([key]) => {
            if (colType === "contacts") {
              return !["first_name", "last_name", "formatted_name", "email", "phone", "organization", "title"].includes(key);
            }
            if (colType === "calendar") {
              return !["summary", "start_date", "end_date", "description", "location"].includes(key);
            }
            return true;
          })
          .map(([key, val]) => (
            <React.Fragment key={key}>
              <div className="metadata-label">{key}</div>
              <div className="metadata-value">{val}</div>
            </React.Fragment>
          ))
        }
      </div>

      {/* Content Preview/Editor */}
      {isEditing ? (
        <div className="form-group" style={{ flex: 1, display: "flex", flexDirection: "column", marginTop: "16px" }}>
          {/* TEXT COLLECTION EDITOR */}
          {colType === "text" && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <span className="panel-section-title" style={{ margin: 0 }}>Note Content</span>
                <button className="btn btn-secondary" style={{ padding: "4px 8px", fontSize: "0.75rem" }} onClick={() => setShowEditPreview(!showEditPreview)}>
                  {showEditPreview ? "Edit Text" : "Preview Markdown"}
                </button>
              </div>
              {showEditPreview ? (
                <div className="content-preview-container" style={{ flex: 1, minHeight: "200px" }}>
                  {renderMarkdown(editText)}
                </div>
              ) : (
                <textarea
                  id="edit-content-textarea"
                  className="form-control"
                  style={{ flex: 1, minHeight: "200px" }}
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                />
              )}
            </>
          )}

          {/* CONTACT COLLECTION EDITOR */}
          {colType === "contacts" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <span className="panel-section-title" style={{ margin: 0 }}>Edit Contact Profile</span>
              <div>
                <label className="form-label" style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "4px", display: "block" }}>First Name</label>
                <input className="form-control" value={editContactFirst} onChange={(e) => setEditContactFirst(e.target.value)} />
              </div>
              <div>
                <label className="form-label" style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "4px", display: "block" }}>Last Name</label>
                <input className="form-control" value={editContactLast} onChange={(e) => setEditContactLast(e.target.value)} />
              </div>
              <div>
                <label className="form-label" style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "4px", display: "block" }}>Email Address</label>
                <input type="email" className="form-control" value={editContactEmail} onChange={(e) => setEditContactEmail(e.target.value)} />
              </div>
              <div>
                <label className="form-label" style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "4px", display: "block" }}>Phone Number</label>
                <input className="form-control" value={editContactPhone} onChange={(e) => setEditContactPhone(e.target.value)} />
              </div>
              <div>
                <label className="form-label" style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "4px", display: "block" }}>Organization / Company</label>
                <input className="form-control" value={editContactOrg} onChange={(e) => setEditContactOrg(e.target.value)} />
              </div>
              <div>
                <label className="form-label" style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "4px", display: "block" }}>Job Title</label>
                <input className="form-control" value={editContactTitle} onChange={(e) => setEditContactTitle(e.target.value)} />
              </div>
            </div>
          )}

          {/* CALENDAR COLLECTION EDITOR */}
          {colType === "calendar" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <span className="panel-section-title" style={{ margin: 0 }}>Edit Calendar Event</span>
              <div>
                <label className="form-label" style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "4px", display: "block" }}>Event Title / Summary</label>
                <input className="form-control" value={editEventSummary} onChange={(e) => setEditEventSummary(e.target.value)} />
              </div>
              <div>
                <label className="form-label" style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "4px", display: "block" }}>Start Date & Time</label>
                <input type="datetime-local" className="form-control" value={editEventStart} onChange={(e) => setEditEventStart(e.target.value)} />
              </div>
              <div>
                <label className="form-label" style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "4px", display: "block" }}>End Date & Time</label>
                <input type="datetime-local" className="form-control" value={editEventEnd} onChange={(e) => setEditEventEnd(e.target.value)} />
              </div>
              <div>
                <label className="form-label" style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "4px", display: "block" }}>Location</label>
                <input className="form-control" value={editEventLoc} onChange={(e) => setEditEventLoc(e.target.value)} />
              </div>
              <div>
                <label className="form-label" style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "4px", display: "block" }}>Event Description</label>
                <textarea className="form-control" value={editEventDesc} onChange={(e) => setEditEventDesc(e.target.value)} style={{ minHeight: "80px" }} />
              </div>
            </div>
          )}

          <div className="edit-actions-container" style={{ marginTop: "16px", marginBottom: "16px" }}>
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
          {/* TEXT VISUAL PREVIEW */}
          {colType === "text" && (
            <>
              <div className="panel-section-title">Raw Content</div>
              <div className="content-preview-container" id="inspector-node-content">
                {renderMarkdown(selectedNode.content)}
              </div>
            </>
          )}

          {/* CONTACT VISUAL PREVIEW */}
          {colType === "contacts" && (
            <>
              <div className="panel-section-title">Contact Card</div>
              {renderContactCard(selectedNode)}
            </>
          )}

          {/* CALENDAR VISUAL PREVIEW */}
          {colType === "calendar" && (
            <>
              <div className="panel-section-title">Event Card</div>
              {renderCalendarCard(selectedNode)}
            </>
          )}

          {selectedNode.is_active && (
            <div className="edit-actions-container" style={{ marginTop: "16px" }}>
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
  );
};
export default InspectorPanel;
