export interface ApiErrorDetail {
  path: string;
  message: string;
}

export interface ApiErrorBody {
  error: string;
  code?: string;
  details?: ApiErrorDetail[];
}
