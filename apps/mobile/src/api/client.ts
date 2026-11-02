import type { LoginInput, RegisterInput } from "@rbm/shared";

import { API_BASE_URL } from "../config";
import { deleteStoredItem, getStoredItem, setStoredItem } from "./storage";

const KEYS = {
  accessToken: "rbm.accessToken",
  accessTokenExpiresAt: "rbm.accessTokenExpiresAt",
  refreshToken: "rbm.refreshToken",
  refreshTokenExpiresAt: "rbm.refreshTokenExpiresAt",
  activeRestaurantId: "rbm.activeRestaurantId"
} as const;

export type SessionTokens = {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
};

export type Membership = {
  id: string;
  status: string;
  joinedAt: string;
  restaurant: {
    id: string;
    name: string;
    currency: string;
    timezone: string;
    status: string;
  };
  role: {
    key: string;
    name: string;
  };
  permissions: string[];
};

export type AuthUser = {
  id: string;
  phone: string;
  email: string | null;
  fullName: string;
  language: "en" | "ny";
  status: string;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  memberships: Membership[];
};

export type RestaurantAccess = {
  membershipId: string;
  joinedAt: string;
  restaurant: Membership["restaurant"];
  role: Membership["role"];
  permissions: string[];
};

export type RestaurantContext = {
  restaurant: Membership["restaurant"];
  membership: {
    id: string;
    status: string;
    role: Membership["role"];
  };
  permissions: string[];
};

export type Member = {
  id: string;
  status: string;
  joinedAt: string;
  createdAt: string;
  updatedAt: string;
  user: {
    id: string;
    fullName: string;
    phone: string;
    email: string | null;
    language: "en" | "ny";
    status: string;
    mustChangePassword: boolean;
    lastLoginAt: string | null;
  };
  role: Membership["role"];
  permissions: string[];
  permissionOverrides: Array<{
    key: string;
    effect: "ALLOW" | "DENY";
  }>;
};

export type RoleDefinition = {
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
};

export type PermissionDefinition = {
  key: string;
  module: string;
  description: string;
};

export type CreateMemberInput = {
  fullName: string;
  phone: string;
  email?: string;
  roleKey: string;
  password?: string;
  language?: "en" | "ny";
};

export type UpdateMemberInput = {
  roleKey?: string;
  status?: "ACTIVE" | "SUSPENDED";
  permissionOverrides?: Array<{
    key: string;
    effect: "ALLOW" | "DENY";
  }>;
};

export type AuthResponse = {
  user: AuthUser;
  tokens: SessionTokens;
};

type ApiErrorPayload = {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
};

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  auth?: boolean;
  retryOnUnauthorized?: boolean;
  restaurantId?: string;
};

let refreshInFlight: Promise<SessionTokens> | null = null;

async function storeSession(tokens: SessionTokens): Promise<void> {
  await Promise.all([
    setStoredItem(KEYS.accessToken, tokens.accessToken),
    setStoredItem(KEYS.accessTokenExpiresAt, tokens.accessTokenExpiresAt),
    setStoredItem(KEYS.refreshToken, tokens.refreshToken),
    setStoredItem(KEYS.refreshTokenExpiresAt, tokens.refreshTokenExpiresAt)
  ]);
}

async function clearStoredSession(): Promise<void> {
  await Promise.all(Object.values(KEYS).map((key) => deleteStoredItem(key)));
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : undefined;

  if (!response.ok) {
    const errorPayload = payload as ApiErrorPayload | undefined;
    const error = errorPayload?.error;

    throw new ApiError(
      response.status,
      error?.code ?? "HTTP_ERROR",
      error?.message ?? response.statusText,
      error?.details
    );
  }

  const data = (payload as { data?: T } | undefined)?.data;

  return (data ?? (payload as T)) as T;
}

async function refreshSession(): Promise<SessionTokens> {
  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = (async () => {
    const refreshToken = await getStoredItem(KEYS.refreshToken);

    if (!refreshToken) {
      throw new ApiError(401, "UNAUTHORIZED", "No refresh token is stored");
    }

    let response: Response;

    try {
      response = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ refreshToken })
      });
    } catch {
      throw new ApiError(
        0,
        "NETWORK_ERROR",
        "The server could not be reached. Check your connection."
      );
    }

    if (!response.ok) {
      await clearStoredSession();
      throw new ApiError(401, "UNAUTHORIZED", "Your session has expired");
    }

    const result = await parseResponse<AuthResponse>(response);
    await storeSession(result.tokens);

    return result.tokens;
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

async function getAccessToken(): Promise<string | null> {
  const [token, expiresAt] = await Promise.all([
    getStoredItem(KEYS.accessToken),
    getStoredItem(KEYS.accessTokenExpiresAt)
  ]);

  if (!token) {
    return null;
  }

  if (expiresAt && Date.parse(expiresAt) <= Date.now() + 30_000) {
    try {
      const refreshed = await refreshSession();
      return refreshed.accessToken;
    } catch {
      await clearStoredSession();
      return null;
    }
  }

  return token;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const {
    method = "GET",
    body,
    auth = true,
    retryOnUnauthorized = true,
    restaurantId
  } = options;

  const headers: Record<string, string> = {
    Accept: "application/json"
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (restaurantId) {
    headers["X-Restaurant-Id"] = restaurantId;
  }

  if (auth) {
    const token = await getAccessToken();

    if (!token) {
      throw new ApiError(401, "UNAUTHORIZED", "Please log in to continue");
    }

    headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    throw new ApiError(
      0,
      "NETWORK_ERROR",
      "The server could not be reached. Check your connection."
    );
  }

  if (response.status === 401 && auth && retryOnUnauthorized) {
    try {
      await refreshSession();
    } catch (error) {
      await clearStoredSession();
      throw error;
    }

    return request<T>(path, { ...options, retryOnUnauthorized: false });
  }

  return parseResponse<T>(response);
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "GET" }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "POST", body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "PATCH", body }),
  delete: <T>(path: string, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "DELETE" })
};

export async function login(input: LoginInput): Promise<AuthResponse> {
  const result = await request<AuthResponse>("/auth/login", {
    method: "POST",
    body: input,
    auth: false
  });

  await storeSession(result.tokens);
  return result;
}

export async function register(input: RegisterInput): Promise<AuthResponse> {
  const result = await request<AuthResponse>("/auth/register", {
    method: "POST",
    body: input,
    auth: false
  });

  await storeSession(result.tokens);
  return result;
}

export async function logout(): Promise<void> {
  const refreshToken = await getStoredItem(KEYS.refreshToken);

  try {
    if (refreshToken) {
      await request<void>("/auth/logout", {
        method: "POST",
        body: { refreshToken },
        auth: false,
        retryOnUnauthorized: false
      });
    }
  } finally {
    await clearStoredSession();
  }
}

export async function getCurrentUser(): Promise<AuthUser> {
  const result = await request<{ user: AuthUser }>("/auth/me");
  return result.user;
}

export async function updateProfile(input: {
  fullName?: string;
  email?: string | null;
  language?: "en" | "ny";
}): Promise<AuthUser> {
  const result = await request<{ user: AuthUser }>("/auth/me", {
    method: "PATCH",
    body: input
  });

  return result.user;
}

export async function changePassword(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  await request<void>("/auth/change-password", {
    method: "POST",
    body: input
  });
}

export async function hasStoredSession(): Promise<boolean> {
  const token = await getStoredItem(KEYS.accessToken);
  return Boolean(token);
}

export async function clearSession(): Promise<void> {
  await clearStoredSession();
}

export async function getActiveRestaurantId(): Promise<string | null> {
  return getStoredItem(KEYS.activeRestaurantId);
}

export async function setActiveRestaurantId(
  restaurantId: string | null
): Promise<void> {
  if (restaurantId) {
    await setStoredItem(KEYS.activeRestaurantId, restaurantId);
    return;
  }

  await deleteStoredItem(KEYS.activeRestaurantId);
}

export async function listRestaurants(): Promise<RestaurantAccess[]> {
  const result = await request<{ restaurants: RestaurantAccess[] }>("/restaurants");
  return result.restaurants;
}

export async function getRestaurantContext(
  restaurantId: string
): Promise<RestaurantContext> {
  return request<RestaurantContext>(`/restaurants/${restaurantId}`, {
    restaurantId
  });
}

export async function listMembers(
  restaurantId: string,
  query: { status?: string; search?: string } = {}
): Promise<Member[]> {
  const params: string[] = [];

  if (query.status) {
    params.push(`status=${encodeURIComponent(query.status)}`);
  }

  if (query.search) {
    params.push(`search=${encodeURIComponent(query.search)}`);
  }

  const suffix = params.length > 0 ? `?${params.join("&")}` : "";
  const result = await request<{ members: Member[] }>(
    `/restaurants/${restaurantId}/users${suffix}`,
    { restaurantId }
  );

  return result.members;
}

export async function getMember(
  restaurantId: string,
  membershipId: string
): Promise<Member> {
  const result = await request<{ member: Member }>(
    `/restaurants/${restaurantId}/users/${membershipId}`,
    { restaurantId }
  );

  return result.member;
}

export async function createMember(
  restaurantId: string,
  input: CreateMemberInput
): Promise<Member> {
  const result = await request<{ member: Member }>(
    `/restaurants/${restaurantId}/users`,
    { method: "POST", body: input, restaurantId }
  );

  return result.member;
}

export async function updateMember(
  restaurantId: string,
  membershipId: string,
  input: UpdateMemberInput
): Promise<Member> {
  const result = await request<{ member: Member }>(
    `/restaurants/${restaurantId}/users/${membershipId}`,
    { method: "PATCH", body: input, restaurantId }
  );

  return result.member;
}

export async function removeMember(
  restaurantId: string,
  membershipId: string
): Promise<void> {
  await request<void>(`/restaurants/${restaurantId}/users/${membershipId}`, {
    method: "DELETE",
    restaurantId
  });
}

export async function listRolesAndPermissions(restaurantId: string): Promise<{
  roles: RoleDefinition[];
  permissions: PermissionDefinition[];
}> {
  return request<{
    roles: RoleDefinition[];
    permissions: PermissionDefinition[];
  }>(`/restaurants/${restaurantId}/roles`, { restaurantId });
}
