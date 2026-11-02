export type AuthUser = {
  id: string;
  phone: string;
  email: string | null;
  fullName: string;
  language: "en" | "ny";
};

export type RestaurantSummary = {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  status: string;
};

export type RestaurantMembership = {
  id: string;
  status: string;
  role: {
    key: string;
    name: string;
  };
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      restaurant?: RestaurantSummary;
      membership?: RestaurantMembership;
      permissions?: Set<string>;
    }
  }
}
