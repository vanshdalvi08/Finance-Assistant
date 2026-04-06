import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BriefcaseBusiness, CheckCheck, Clock3, CreditCard, Receipt, UserRound } from "lucide-react";
import { api, type NotificationItem } from "@/lib/api";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

function formatNotificationTime(value: string) {
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.max(1, Math.round(diffMs / 60000));

  if (diffMinutes < 60) {
    return diffMinutes <= 1 ? "Just now" : `${diffMinutes} min ago`;
  }

  if (diffMinutes < 24 * 60) {
    const hours = Math.round(diffMinutes / 60);
    return `${hours}h ago`;
  }

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
  });
}

function NotificationIcon({ kind }: { kind: NotificationItem["kind"] }) {
  const className = "h-4 w-4";

  switch (kind) {
    case "timesheet":
      return <Clock3 className={className} />;
    case "expense":
      return <Receipt className={className} />;
    case "salary":
      return <CreditCard className={className} />;
    case "purchase-order":
      return <BriefcaseBusiness className={className} />;
    case "employee":
      return <UserRound className={className} />;
    default:
      return <Bell className={className} />;
  }
}

export function NotificationCenter() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data, isFetching } = useQuery({
    queryKey: ["notifications"],
    queryFn: api.getNotifications,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  const markReadMutation = useMutation({
    mutationFn: api.markNotificationRead,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const markAllMutation = useMutation({
    mutationFn: api.markAllNotificationsRead,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const unreadCount = data?.unreadCount ?? 0;
  const notifications = data?.notifications ?? [];
  const hasNotifications = notifications.length > 0;

  const groupedLabel = useMemo(() => {
    if (!unreadCount) {
      return "Notifications";
    }

    return unreadCount > 9 ? "9+" : String(unreadCount);
  }, [unreadCount]);

  async function handleNotificationClick(notification: NotificationItem) {
    if (!notification.readAt) {
      await markReadMutation.mutateAsync(notification.id);
    }

    if (notification.link) {
      setLocation(notification.link);
      setOpen(false);
    }
  }

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          void queryClient.invalidateQueries({ queryKey: ["notifications"] });
        }
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="relative flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 ? (
            <span className="absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full border border-sky-500/20 bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-300">
              {groupedLabel}
            </span>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-[380px] rounded-2xl border-border/70 bg-card/98 p-0 shadow-2xl"
        sideOffset={12}
      >
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Notifications</p>
            <p className="text-xs text-muted-foreground">
              {unreadCount ? `${unreadCount} unread` : "Everything is caught up"}
            </p>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-xl border border-border/60 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-border hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void markAllMutation.mutateAsync()}
            disabled={!unreadCount || markAllMutation.isPending}
          >
            <CheckCheck className="h-3.5 w-3.5" />
            Mark all read
          </button>
        </div>

        <div className="max-h-[420px] overflow-y-auto">
          {!hasNotifications ? (
            <div className="px-4 py-10 text-center">
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-2xl border border-border/60 bg-secondary/30 text-muted-foreground">
                <Bell className="h-4 w-4" />
              </div>
              <p className="text-sm font-medium text-foreground">No notifications yet</p>
              <p className="mt-1 text-xs text-muted-foreground">Approvals, reminders, and updates will show up here.</p>
            </div>
          ) : (
            notifications.map((notification) => (
              <button
                key={notification.id}
                type="button"
                onClick={() => void handleNotificationClick(notification)}
                className={cn(
                  "flex w-full items-start gap-3 border-b border-border/50 px-4 py-3 text-left transition-colors hover:bg-secondary/20",
                  !notification.readAt && "bg-sky-500/[0.04]",
                )}
              >
                <div
                  className={cn(
                    "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-border/60 bg-secondary/30 text-muted-foreground",
                    !notification.readAt && "border-sky-500/20 bg-sky-500/[0.08] text-sky-300",
                  )}
                >
                  <NotificationIcon kind={notification.kind} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium text-foreground">{notification.title}</p>
                    <div className="flex items-center gap-2">
                      {!notification.readAt ? <span className="mt-1 h-2 w-2 rounded-full bg-sky-400" /> : null}
                      <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                        {formatNotificationTime(notification.createdAt)}
                      </span>
                    </div>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{notification.message}</p>
                </div>
              </button>
            ))
          )}
        </div>

        <div className="border-t border-border/60 px-4 py-2.5 text-[11px] text-muted-foreground">
          {isFetching ? "Refreshing notifications..." : "Notifications stay synced with approvals and submissions."}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
