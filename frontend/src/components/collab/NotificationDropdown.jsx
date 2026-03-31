import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Bell,
  UserPlus,
  UserMinus,
  ArrowRightLeft,
  Check,
  XCircle,
  CheckCheck,
  Trash2,
} from 'lucide-react';
import { collabApi } from '../../services/collabApi.js';
import { timeAgo } from '../../utils/datetime.js';

const TYPE_CONFIG = {
  invitation: { Icon: UserPlus, color: 'text-gh-accent' },
  role_change: { Icon: ArrowRightLeft, color: 'text-gh-warning' },
  removed: { Icon: UserMinus, color: 'text-gh-danger' },
  accepted: { Icon: Check, color: 'text-gh-success' },
  declined: { Icon: XCircle, color: 'text-gh-text-secondary' },
};

export function NotificationDropdown({ currentUserId, onNotificationNavigate }) {
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

  const handleClearAll = async () => {
    await collabApi.clearAllNotifications(currentUserId);
    await fetchNotifications();
  };

  const handleMarkRead = async (id) => {
    await collabApi.markNotificationRead(id);
    await fetchNotifications();
  };

  const handleClearOne = async (notifId) => {
    await collabApi.clearNotification(notifId);
    await fetchNotifications();
  };

  const handleNotificationClick = async (notif) => {
    if (!notif?.read) {
      await handleMarkRead(notif.id);
    }

    if (typeof onNotificationNavigate === 'function') {
      onNotificationNavigate(notif);
    }

    setOpen(false);
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
            <div className="flex items-center gap-3">
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
              {notifications.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearAll}
                  className="flex items-center gap-1 text-xs text-gh-danger hover:text-gh-danger font-medium hover:underline"
                >
                  <Trash2 size={14} />
                  Clear all
                </button>
              )}
            </div>
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
                  <div
                    key={notif.id}
                    className={`w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-gh-overlay transition-colors border-b border-gh-border-muted last:border-b-0 ${
                      !notif.read ? 'bg-gh-accent/5' : ''
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleNotificationClick(notif)}
                      className="flex items-start gap-3 flex-1 min-w-0 text-left"
                    >
                      <div className={`mt-0.5 ${cfg.color}`}>
                        <Icon size={16} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gh-text leading-snug">{notif.message}</p>
                        <p className="text-xs text-gh-text-muted mt-1">{timeAgo(notif.created_at)}</p>
                      </div>
                    </button>
                    <button
                      type="button"
                      aria-label="Clear notification"
                      onClick={() => handleClearOne(notif.id)}
                      className="mt-0.5 p-1 rounded text-gh-text-muted hover:text-gh-danger hover:bg-red-500/10 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                    {!notif.read && (
                      <div className="mt-1.5 w-2 h-2 rounded-full bg-gh-accent shrink-0" />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
