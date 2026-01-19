import { LinearTicket } from '../linear';
import { TenantConfig } from '../config/tenants';

export type NotificationEventType =
  | 'agent-started'
  | 'agent-completed'
  | 'agent-failed'
  | 'pr-created';

export interface BaseNotificationEvent {
  type: NotificationEventType;
  ticket: LinearTicket;
  tenant: TenantConfig;
  timestamp: Date;
}

export interface AgentStartedEvent extends BaseNotificationEvent {
  type: 'agent-started';
  branchName: string;
}

export interface AgentCompletedEvent extends BaseNotificationEvent {
  type: 'agent-completed';
  branchName: string;
  duration: number; // milliseconds
}

export interface AgentFailedEvent extends BaseNotificationEvent {
  type: 'agent-failed';
  branchName: string;
  error: string;
  attempt: number;
  maxAttempts: number;
}

export interface PrCreatedEvent extends BaseNotificationEvent {
  type: 'pr-created';
  prUrl: string;
  branchName: string;
}

export type NotificationEvent =
  | AgentStartedEvent
  | AgentCompletedEvent
  | AgentFailedEvent
  | PrCreatedEvent;

export interface NotificationProvider {
  name: string;
  send(event: NotificationEvent, config: Record<string, string>): Promise<void>;
}
