import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Collection, GraphNode } from "../types";

interface PieceFormProps {
  collections: Collection[];
  selectedCollectionId: string;
  setSelectedCollectionId: (id: string) => void;
  activeTab: "text" | "contacts" | "calendar";
  setActiveTab: (tab: "text" | "contacts" | "calendar") => void;
  isWebMode: boolean;
  addToast: (msg: string, type?: "success" | "error") => void;
  loadWorkspace: () => Promise<void>;
  onAddMockPiece: (piece: GraphNode) => void;
}

export const PieceForm: React.FC<PieceFormProps> = ({
  collections,
  selectedCollectionId,
  setSelectedCollectionId,
  activeTab,
  setActiveTab,
  isWebMode,
  addToast,
  loadWorkspace,
  onAddMockPiece,
}) => {
  // Unstructured Text note content
  const [noteContent, setNoteContent] = useState("");

  // Contact (PIM) fields
  const [contactFirst, setContactFirst] = useState("");
  const [contactLast, setContactLast] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactOrg, setContactOrg] = useState("");
  const [contactTitle, setContactTitle] = useState("");

  // Calendar Event fields
  const [eventSummary, setEventSummary] = useState("");
  const [eventStart, setEventStart] = useState("");
  const [eventEnd, setEventEnd] = useState("");
  const [eventDesc, setEventDesc] = useState("");
  const [eventLoc, setEventLoc] = useState("");

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
        title: contactTitle,
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
        description: eventDesc,
      };
    }

    const resetForms = () => {
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
    };

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
        metadata: metadataObj,
      };

      onAddMockPiece(newPiece);
      resetForms();
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
        pieceType: activeTab === "text" ? "text" : activeTab === "contacts" ? "contacts" : "calendar",
      });

      resetForms();
      addToast("Piece ingested successfully!");
      await loadWorkspace();
    } catch (e: any) {
      addToast(String(e), "error");
    }
  };

  return (
    <div>
      <h4 className="panel-section-title">Ingest New Piece</h4>

      <div style={{ display: "flex", gap: "4px", marginBottom: "16px", background: "rgba(0,0,0,0.2)", padding: "4px", borderRadius: "8px" }}>
        <button
          type="button"
          id="tab-note"
          className={`btn btn-secondary ${activeTab === "text" ? "btn-primary" : ""}`}
          style={{ flex: 1, padding: "6px 8px", fontSize: "0.75rem" }}
          onClick={() => {
            setActiveTab("text");
            setSelectedCollectionId("");
          }}
        >
          Note
        </button>
        <button
          type="button"
          id="tab-contact"
          className={`btn btn-secondary ${activeTab === "contacts" ? "btn-primary" : ""}`}
          style={{ flex: 1, padding: "6px 8px", fontSize: "0.75rem" }}
          onClick={() => {
            setActiveTab("contacts");
            setSelectedCollectionId("");
          }}
        >
          Contact
        </button>
        <button
          type="button"
          id="tab-event"
          className={`btn btn-secondary ${activeTab === "calendar" ? "btn-primary" : ""}`}
          style={{ flex: 1, padding: "6px 8px", fontSize: "0.75rem" }}
          onClick={() => {
            setActiveTab("calendar");
            setSelectedCollectionId("");
          }}
        >
          Event
        </button>
      </div>

      <form onSubmit={handleCreatePiece}>
        <div className="form-group">
          <label htmlFor="target-collection">Target Collection</label>
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
            <label htmlFor="note-content">Note Content (Markdown)</label>
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
                <label htmlFor="contact-first">First Name</label>
                <input
                  id="contact-first"
                  className="form-control"
                  value={contactFirst}
                  onChange={(e) => setContactFirst(e.target.value)}
                  placeholder="John"
                />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label htmlFor="contact-last">Last Name</label>
                <input
                  id="contact-last"
                  className="form-control"
                  value={contactLast}
                  onChange={(e) => setContactLast(e.target.value)}
                  placeholder="Doe"
                />
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="contact-email">Email Address</label>
              <input
                id="contact-email"
                className="form-control"
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="john@company.com"
              />
            </div>
            <div className="form-group">
              <label htmlFor="contact-phone">Phone Number</label>
              <input
                id="contact-phone"
                className="form-control"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="+1-555-0100"
              />
            </div>
            <div className="form-group">
              <label htmlFor="contact-org">Organization</label>
              <input
                id="contact-org"
                className="form-control"
                value={contactOrg}
                onChange={(e) => setContactOrg(e.target.value)}
                placeholder="Acme Inc."
              />
            </div>
            <div className="form-group">
              <label htmlFor="contact-title">Job Title</label>
              <input
                id="contact-title"
                className="form-control"
                value={contactTitle}
                onChange={(e) => setContactTitle(e.target.value)}
                placeholder="Software Director"
              />
            </div>
          </>
        )}

        {activeTab === "calendar" && (
          <>
            <div className="form-group">
              <label htmlFor="event-summary">Event Summary (Title)</label>
              <input
                id="event-summary"
                className="form-control"
                value={eventSummary}
                onChange={(e) => setEventSummary(e.target.value)}
                placeholder="Design Review Session"
              />
            </div>
            <div className="form-group">
              <label htmlFor="event-start">Start Date & Time</label>
              <input
                id="event-start"
                className="form-control"
                type="datetime-local"
                value={eventStart}
                onChange={(e) => setEventStart(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label htmlFor="event-end">End Date & Time</label>
              <input
                id="event-end"
                className="form-control"
                type="datetime-local"
                value={eventEnd}
                onChange={(e) => setEventEnd(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label htmlFor="event-loc">Location</label>
              <input
                id="event-loc"
                className="form-control"
                value={eventLoc}
                onChange={(e) => setEventLoc(e.target.value)}
                placeholder="Zoom Meeting Room"
              />
            </div>
            <div className="form-group">
              <label htmlFor="event-desc">Description</label>
              <textarea
                id="event-desc"
                className="form-control"
                value={eventDesc}
                onChange={(e) => setEventDesc(e.target.value)}
                placeholder="Sync meeting to discuss roadmap..."
              />
            </div>
          </>
        )}

        <button id="btn-ingest" className="btn btn-primary btn-block" type="submit">
          Ingest Piece
        </button>
      </form>
    </div>
  );
};
export default PieceForm;
