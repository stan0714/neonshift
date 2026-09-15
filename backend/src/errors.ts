/**
 * 統一錯誤格式（SD 4.1）：`{ error: { code, message, rules_version? } }`。
 * `rules_version` 只在風險判定相關錯誤出現；驗證、限流或系統錯誤不得填入。
 */
export type ApiErrorBody = {
  error: { code: string; message: string; rules_version?: number; request_id?: string };
};

/** 附上 Fastify request id（Style 14：generic error 顯示 reference ID 供客服對照 audit log） */
export function withRequestId(body: ApiErrorBody, requestId: string): ApiErrorBody {
  return { error: { ...body.error, request_id: requestId } };
}

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly rulesVersion?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }

  toBody(): ApiErrorBody {
    const error: ApiErrorBody["error"] = { code: this.code, message: this.message };
    if (this.rulesVersion !== undefined) error.rules_version = this.rulesVersion;
    return { error };
  }
}

export const notFound = (what = "route") => new ApiError(404, "NOT_FOUND", `${what} not found`);
