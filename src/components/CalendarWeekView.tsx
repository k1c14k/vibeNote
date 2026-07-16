import React, { useState, useEffect } from "react";
import { GraphNode } from "../types";

interface CalendarWeekViewProps {
  nodes: GraphNode[];
  selectedNode: GraphNode | null;
  setSelectedNode: (node: GraphNode | null) => void;
  searchQuery: string;
}

export const CalendarWeekView: React.FC<CalendarWeekViewProps> = ({
  nodes,
  selectedNode,
  setSelectedNode,
  searchQuery,
}) => {
  const [currentWeekStart, setCurrentWeekStart] = useState<Date>(new Date());

  // Helper: get the Monday of the week containing date `d`
  const getMonday = (d: Date) => {
    const date = new Date(d);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(date.setDate(diff));
    monday.setHours(0, 0, 0, 0);
    return monday;
  };

  // Find the earliest event date to default the calendar focus if current week is empty
  useEffect(() => {
    const calendarNodes = nodes.filter(
      (n) => n.is_active && n.metadata.start_date
    );
    if (calendarNodes.length > 0) {
      // Find earliest start date
      let earliest = new Date();
      let hasEarliest = false;
      for (const node of calendarNodes) {
        try {
          const d = new Date(node.metadata.start_date);
          if (!isNaN(d.getTime())) {
            if (!hasEarliest || d < earliest) {
              earliest = d;
              hasEarliest = true;
            }
          }
        } catch {}
      }
      if (hasEarliest) {
        setCurrentWeekStart(getMonday(earliest));
      } else {
        setCurrentWeekStart(getMonday(new Date()));
      }
    } else {
      setCurrentWeekStart(getMonday(new Date()));
    }
  }, [nodes]);

  // Navigate weeks
  const handlePrevWeek = () => {
    setCurrentWeekStart((prev) => {
      const next = new Date(prev);
      next.setDate(prev.getDate() - 7);
      return next;
    });
  };

  const handleNextWeek = () => {
    setCurrentWeekStart((prev) => {
      const next = new Date(prev);
      next.setDate(prev.getDate() + 7);
      return next;
    });
  };

  const handleToday = () => {
    setCurrentWeekStart(getMonday(new Date()));
  };

  // Get the 7 days of the current week
  const getWeekDays = () => {
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(currentWeekStart);
      d.setDate(currentWeekStart.getDate() + i);
      days.push(d);
    }
    return days;
  };

  const weekDays = getWeekDays();

  // Filter and match events to days
  const activeEvents = nodes.filter((node) => {
    if (!node.is_active) return false;
    if (!node.metadata.start_date) return false;
    
    // Global query search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const summary = (node.metadata.summary || "").toLowerCase();
      const desc = (node.metadata.description || "").toLowerCase();
      const loc = (node.metadata.location || "").toLowerCase();
      return summary.includes(q) || desc.includes(q) || loc.includes(q);
    }
    return true;
  });

  const getEventsForDay = (day: Date) => {
    return activeEvents.filter((event) => {
      try {
        const eventDate = new Date(event.metadata.start_date);
        return (
          eventDate.getFullYear() === day.getFullYear() &&
          eventDate.getMonth() === day.getMonth() &&
          eventDate.getDate() === day.getDate()
        );
      } catch {
        return false;
      }
    }).sort((a, b) => {
      try {
        return new Date(a.metadata.start_date).getTime() - new Date(b.metadata.start_date).getTime();
      } catch {
        return 0;
      }
    });
  };

  const formatWeekRange = () => {
    const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };
    const startStr = weekDays[0].toLocaleDateString(undefined, options);
    const endStr = weekDays[6].toLocaleDateString(undefined, options);
    return `${startStr} – ${endStr}`;
  };

  const formatEventTime = (startStr: string, endStr?: string) => {
    try {
      const start = new Date(startStr);
      const startTime = start.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
      if (endStr) {
        const end = new Date(endStr);
        const endTime = end.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
        return `${startTime} - ${endTime}`;
      }
      return startTime;
    } catch {
      return "All Day";
    }
  };

  const isToday = (day: Date) => {
    const today = new Date();
    return (
      day.getFullYear() === today.getFullYear() &&
      day.getMonth() === today.getMonth() &&
      day.getDate() === today.getDate()
    );
  };

  return (
    <div className="calendar-week-view animate-fade-in">
      <div className="calendar-nav-bar">
        <h3 className="week-range-text">{formatWeekRange()}</h3>
        <div className="calendar-nav-buttons">
          <button className="btn btn-secondary btn-icon" onClick={handlePrevWeek} title="Previous Week">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <button className="btn btn-secondary" onClick={handleToday}>
            Today
          </button>
          <button className="btn btn-secondary btn-icon" onClick={handleNextWeek} title="Next Week">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </div>
      </div>

      <div className="week-grid-container">
        <div className="week-grid">
          {weekDays.map((day) => {
            const dayEvents = getEventsForDay(day);
            const isDayToday = isToday(day);
            const dayName = day.toLocaleDateString(undefined, { weekday: "short" });
            const dayNum = day.getDate();

            return (
              <div key={day.toISOString()} className={`day-column ${isDayToday ? "today" : ""}`}>
                <div className="day-column-header">
                  <span className="day-name">{dayName}</span>
                  <span className="day-number-circle">{dayNum}</span>
                </div>
                <div className="day-column-events">
                  {dayEvents.length === 0 ? (
                    <span className="no-events-placeholder">No events</span>
                  ) : (
                    dayEvents.map((event) => {
                      const isSelected = selectedNode?.id === event.id;
                      const summary = event.metadata.summary || "Untitled Event";
                      const timeStr = formatEventTime(event.metadata.start_date, event.metadata.end_date);
                      const location = event.metadata.location;

                      return (
                        <div
                          key={event.id}
                          className={`calendar-event-card ${isSelected ? "selected" : ""}`}
                          onClick={() => setSelectedNode(event)}
                        >
                          <div className="event-time">{timeStr}</div>
                          <h4 className="event-summary">{summary}</h4>
                          {location && (
                            <div className="event-location">
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: "4px" }}>
                                <path d="M12 2a8 8 0 0 0-8 8c0 5.25 8 12 8 12s8-6.75 8-12a8 8 0 0 0-8-8z"></path>
                                <circle cx="12" cy="10" r="3"></circle>
                              </svg>
                              {location}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
export default CalendarWeekView;
