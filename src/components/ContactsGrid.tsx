import React from "react";
import { GraphNode } from "../types";

interface ContactsGridProps {
  nodes: GraphNode[];
  selectedNode: GraphNode | null;
  setSelectedNode: (node: GraphNode | null) => void;
  searchQuery: string;
}

export const ContactsGrid: React.FC<ContactsGridProps> = ({
  nodes,
  selectedNode,
  setSelectedNode,
  searchQuery,
}) => {
  // Filter contacts
  const filteredContacts = nodes.filter((node) => {
    if (!node.is_active) return false;
    
    const fn = (node.metadata.formatted_name || "").toLowerCase();
    const org = (node.metadata.organization || "").toLowerCase();
    const title = (node.metadata.title || "").toLowerCase();
    const email = (node.metadata.email || "").toLowerCase();
    const phone = (node.metadata.phone || "").toLowerCase();
    const query = searchQuery.toLowerCase();

    return (
      fn.includes(query) ||
      org.includes(query) ||
      title.includes(query) ||
      email.includes(query) ||
      phone.includes(query)
    );
  });

  const getInitials = (name: string) => {
    if (!name) return "?";
    const parts = name.split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  // Generate a distinct gradient based on the contact name hash
  const getAvatarGradient = (name: string) => {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h1 = Math.abs(hash % 360);
    const h2 = (h1 + 60) % 360;
    return `linear-gradient(135deg, hsl(${h1}, 75%, 60%) 0%, hsl(${h2}, 85%, 45%) 100%)`;
  };

  return (
    <div className="contacts-grid-view animate-fade-in">
      {filteredContacts.length === 0 ? (
        <div className="empty-grid-state">
          <p>No contacts found matching the current query.</p>
        </div>
      ) : (
        <div className="contacts-grid">
          {filteredContacts.map((node) => {
            const isSelected = selectedNode?.id === node.id;
            const fn = node.metadata.formatted_name || "Unnamed Contact";
            const title = node.metadata.title;
            const org = node.metadata.organization;
            const email = node.metadata.email;
            const phone = node.metadata.phone;

            return (
              <div
                key={node.id}
                className={`contact-grid-card ${isSelected ? "selected" : ""}`}
                onClick={() => setSelectedNode(node)}
              >
                <div
                  className="contact-avatar-circle"
                  style={{ background: getAvatarGradient(fn) }}
                >
                  {getInitials(fn)}
                </div>
                <h3 className="contact-card-name">{fn}</h3>
                {title && <p className="contact-card-title-text">{title}</p>}
                {org && <p className="contact-card-org-text">{org}</p>}
                
                <div className="contact-card-divider" />
                
                <div className="contact-card-links">
                  {email && (
                    <a
                      href={`mailto:${email}`}
                      className="contact-card-link"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                        <polyline points="22,6 12,13 2,6"></polyline>
                      </svg>
                      {email}
                    </a>
                  )}
                  {phone && (
                    <a
                      href={`tel:${phone}`}
                      className="contact-card-link"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                      </svg>
                      {phone}
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
export default ContactsGrid;
