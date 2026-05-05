import { EventEmitter } from "node:events";
import type { DayKey, TimesheetEntry, UserProfile } from "./business-store";

export interface TimesheetApprovedEvent {
  tenantId: string;
  timesheet: TimesheetEntry;
  employee: UserProfile | null;
  approvedBy: {
    userId?: string;
    name: string;
  };
}

export interface TimesheetDailyReviewVerifiedEvent {
  tenantId: string;
  timesheet: TimesheetEntry;
  employee: UserProfile | null;
  day: DayKey;
  verifiedBy: {
    userId?: string;
    name: string;
  };
}

type AppEventMap = {
  timesheet_approved: TimesheetApprovedEvent;
  timesheet_daily_review_verified: TimesheetDailyReviewVerifiedEvent;
};

class TypedAppEvents extends EventEmitter {
  emit<EventName extends keyof AppEventMap>(eventName: EventName, payload: AppEventMap[EventName]): boolean {
    return super.emit(eventName, payload);
  }

  on<EventName extends keyof AppEventMap>(
    eventName: EventName,
    listener: (payload: AppEventMap[EventName]) => void,
  ): this {
    return super.on(eventName, listener);
  }
}

export const appEvents = new TypedAppEvents();
