export type StudioRole = "owner" | "coauthor" | "tester";

export type StudioConnectionState =
  | "connected"
  | "syncing"
  | "offline"
  | "conflict";

export type StudioPresenceState = "online" | "idle" | "offline";

export type StudioProposalStatus =
  | "draft"
  | "ready_for_test"
  | "testing"
  | "changes_requested"
  | "approved"
  | "publishing"
  | "published"
  | "rejected"
  | "conflict";

export type StudioValidationState = "pending" | "passed" | "failed";

export type StudioComparisonTarget = "current" | "candidate";

export type StudioRightPanelTab = "inspector" | "chat" | "assistant";

export type StudioBottomPanelTab =
  | "changes"
  | "problems"
  | "tests"
  | "activity";

export type StudioMobileView =
  | "project"
  | "sandbox"
  | "collaboration"
  | "review";

export type StudioLayoutPreference = "auto" | "desktop" | "mobile";

export type StudioResolvedLayout = "desktop" | "mobile";

export type StudioSandboxControl =
  | "move-up"
  | "move-left"
  | "move-down"
  | "move-right"
  | "fire"
  | "action"
  | "pause";

export type StudioSandboxControlPhase = "start" | "end";

export interface StudioSandboxControlEvent {
  readonly control: StudioSandboxControl;
  readonly phase: StudioSandboxControlPhase;
}

export type StudioPanelItemTone = "neutral" | "success" | "warning" | "error";

export interface StudioMemberSummary {
  readonly id: string;
  readonly displayName: string;
  readonly initials: string;
  readonly presence: StudioPresenceState;
  readonly currentContext?: string;
}

export interface StudioProposalSummary {
  readonly id: string;
  readonly revisionId: string;
  readonly title: string;
  readonly summary: string;
  readonly authorName: string;
  readonly updatedAtLabel: string;
  readonly status: StudioProposalStatus;
  readonly changeCount: number;
  readonly problemCount: number;
}

export interface StudioInspectorField {
  readonly id: string;
  readonly label: string;
  readonly value: string;
}

export interface StudioInspectorModel {
  readonly selectionLabel: string;
  readonly description: string;
  readonly fields: readonly StudioInspectorField[];
}

export interface StudioChatMessage {
  readonly id: string;
  readonly authorName: string;
  readonly body: string;
  readonly createdAtLabel: string;
  readonly isCurrentUser?: boolean;
}

export interface StudioChatModel {
  readonly channelId: string;
  readonly channelLabel: string;
  readonly messages: readonly StudioChatMessage[];
  readonly canPost: boolean;
}

export type StudioAssistantMessageRole = "user" | "assistant" | "system";

export interface StudioAssistantMessage {
  readonly id: string;
  readonly role: StudioAssistantMessageRole;
  readonly body: string;
  readonly createdAtLabel?: string;
}

export type StudioAssistantState = "ready" | "working" | "unavailable";

export interface StudioAssistantModelOption {
  readonly id: string;
  readonly label: string;
  readonly contextWindow: number | null;
}

export interface StudioAssistantModel {
  readonly state: StudioAssistantState;
  readonly statusLabel: string;
  readonly messages: readonly StudioAssistantMessage[];
  readonly canPrompt: boolean;
  readonly models: readonly StudioAssistantModelOption[];
  readonly selectedModelId: string | null;
}

export interface StudioPanelItem {
  readonly id: string;
  readonly title: string;
  readonly detail?: string;
  readonly tone?: StudioPanelItemTone;
}

export interface StudioApprovalModel {
  readonly candidateRevisionId: string | null;
  readonly testedRevisionId: string | null;
  readonly validationState: StudioValidationState;
  readonly unresolvedProblemCount: number;
  readonly isSubmitting?: boolean;
  readonly isPublishing: boolean;
}

export interface StudioShellModel {
  readonly workspaceId: string;
  readonly projectName: string;
  readonly currentUserId: string;
  readonly role: StudioRole;
  readonly connectionState: StudioConnectionState;
  readonly publishedVersion: string;
  readonly deploymentLabel: string;
  readonly members: readonly StudioMemberSummary[];
  readonly proposals: readonly StudioProposalSummary[];
  readonly selectedProposalId: string | null;
  readonly comparisonTarget: StudioComparisonTarget;
  readonly rightPanelTab: StudioRightPanelTab;
  readonly bottomPanelTab: StudioBottomPanelTab;
  readonly mobileView: StudioMobileView;
  readonly layoutPreference: StudioLayoutPreference;
  readonly inspector: StudioInspectorModel;
  readonly chat: StudioChatModel;
  readonly assistant: StudioAssistantModel;
  readonly changes: readonly StudioPanelItem[];
  readonly problems: readonly StudioPanelItem[];
  readonly tests: readonly StudioPanelItem[];
  readonly activity: readonly StudioPanelItem[];
  readonly approval: StudioApprovalModel;
}

export interface StudioApproveRequest {
  readonly workspaceId: string;
  readonly proposalId: string;
  readonly revisionId: string;
}

export interface StudioShellOptions {
  readonly onSelectProposal?: (proposalId: string) => void;
  readonly onComparisonChange?: (target: StudioComparisonTarget) => void;
  readonly onRightPanelChange?: (tab: StudioRightPanelTab) => void;
  readonly onBottomPanelChange?: (tab: StudioBottomPanelTab) => void;
  readonly onMobileViewChange?: (view: StudioMobileView) => void;
  readonly onLayoutPreferenceChange?: (
    preference: StudioLayoutPreference,
  ) => void;
  readonly onSandboxControl?: (event: StudioSandboxControlEvent) => void;
  readonly onExitStudio?: () => void;
  readonly onLogout?: () => void | Promise<void>;
  readonly onSendChat?: (channelId: string, message: string) => void | Promise<void>;
  readonly onAskAssistant?: (
    prompt: string,
    modelId: string,
  ) => void | Promise<void>;
  readonly onAssistantModelChange?: (modelId: string) => void;
  readonly onApprove?: (request: StudioApproveRequest) => void | Promise<void>;
}

export interface StudioShellHandle {
  update(model: StudioShellModel): void;
  destroy(): void;
}

export interface StudioApprovalControlState {
  readonly visible: boolean;
  readonly disabled: boolean;
  readonly label: string;
  readonly reason: string;
}
