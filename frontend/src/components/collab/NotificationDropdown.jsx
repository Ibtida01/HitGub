import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Bell,
  UserPlus,
  UserMinus,
  ArrowRightLeft,
  Check,
  XCircle,
  CheckCheck,
} from 'lucide-react';
import { collabApi } from '../../services/collabApi.js';

const TYPE_CONFIG = {
  invitation: { Icon: UserPlus, color: 'text-gh-accent' },
  role_change: { Icon: ArrowRightLeft, color: 'text-gh-warning' },
  removed: { Icon: UserMinus, color: 'text-gh-danger' },
  accepted: { Icon: Check, color: 'text-gh-success' },
  declined: { Icon: XCircle, color: 'text-gh-text-secondary' },
};

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export function NotificationDropdown({ currentUserId }) {
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const data = await collabApi.getNotifications(currentUserId);
      setNotifications(data);
    } catch {
      /* ignore */
    }
  }, [currentUserId]);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 5000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const handleMarkAllRead = async () => {
    await collabApi.markAllNotificationsRead(currentUserId);
    await fetchNotifications();
  };

  const handleMarkRead = async (id) => {
    await collabApi.markNotificationRead(id);
    await fetchNotifications();
  };

  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen(!open);
          if (!open) fetchNotifications();
        }}
        className="relative p-2 rounded-md hover:bg-white/10 text-gh-text-secondary hover:text-gh-text transition-colors"
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-gh-accent text-white text-[10px] font-bold px-1">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-96 bg-gh-canvas-subtle border border-gh-border rounded-xl shadow-xl shadow-black/40 z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gh-border">
            <h3 className="text-sm font-semibold text-gh-text">Notifications</h3>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="flex items-center gap-1 text-xs text-gh-accent hover:text-gh-accent font-medium hover:underline"
              >
                <CheckCheck size={14} />
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="py-10 text-center">
                <Bell size={24} className="mx-auto text-gh-text-muted mb-2" />
                <p className="text-sm text-gh-text-secondary">No notifications yet</p>
              </div>
            ) : (
              notifications.map((notif) => {
                const cfg = TYPE_CONFIG[notif.type] ?? TYPE_CONFIG.invitation;
                const Icon = cfg.Icon;
                return (
                  <button
                    type="button"
                    key={notif.id}
                    onClick={() => handleMarkRead(notif.id)}
                    className={`w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-gh-overlay transition-colors border-b border-gh-border-muted last:border-b-0 ${
                      !notif.read ? 'bg-gh-accent/5' : ''
                    }`}
                  >
                    <div className={`mt-0.5 ${cfg.color}`}>
                      <Icon size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gh-text leading-snug">{notif.message}</p>
                      <p className="text-xs text-gh-text-muted mt-1">{timeAgo(notif.created_at)}</p>
                    </div>
                    {!notif.read && (
                      <div className="mt-1.5 w-2 h-2 rounded-full bg-gh-accent shrink-0" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
