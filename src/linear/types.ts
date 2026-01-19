export interface LinearState {
  id: string;
  name: string;
}

export interface LinearTeam {
  id: string;
  name: string;
}

export interface LinearTicket {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  state: LinearState;
  team: LinearTeam;
}

export interface LinearComment {
  id: string;
  body: string;
}

export interface LinearLabel {
  id: string;
  name: string;
  color: string;
}

export interface LinearApiError {
  message: string;
}

export interface LinearIssueResponse {
  data?: {
    issue?: LinearTicket;
  };
  errors?: LinearApiError[];
}

export interface LinearStatesResponse {
  data?: {
    team?: {
      states: {
        nodes: LinearState[];
      };
    };
  };
  errors?: LinearApiError[];
}

export interface LinearMutationResponse {
  data?: {
    issueUpdate?: { success: boolean };
    commentCreate?: { success: boolean; comment?: LinearComment };
    issueLabelCreate?: { success: boolean; issueLabel?: LinearLabel };
  };
  errors?: LinearApiError[];
}
