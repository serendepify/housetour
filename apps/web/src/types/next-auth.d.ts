import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email?: string | null;
      name?: string | null;
      image?: string | null;
      organizationId?: string;
      organizationSlug?: string;
      role?: string;
    };
  }

  interface User {
    organizationId?: string;
    organizationSlug?: string;
    role?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    organizationId?: string;
    organizationSlug?: string;
    role?: string;
  }
}
