import { authOptions } from "./options";
import prisma from "@/lib/prisma";
import { Link as LinkProps } from "@prisma/client";
import { PlanProps, ProjectProps } from "../types";
import { getServerSession } from "next-auth/next";
import { createHash } from "crypto";
import { API_DOMAIN, getSearchParams, isDubDomain } from "@dub/utils";
import { ratelimit } from "../upstash";
import { exceededLimitError } from "../api/errors";
import { isAdmin } from "app/admin.dub.co/actions";

export interface Session {
  user: {
    email: string;
    id: string;
    name: string;
    image?: string;
  };
}

export const getSession = async () => {
  return getServerSession(authOptions) as Promise<Session>;
};

export const hashToken = (
  token: string,
  {
    noSecret = false,
  }: {
    noSecret?: boolean;
  } = {},
) => {
  return createHash("sha256")
    .update(`${token}${noSecret ? "" : process.env.NEXTAUTH_SECRET}`)
    .digest("hex");
};

interface WithAuthHandler {
  ({
    req,
    params,
    searchParams,
    headers,
    session,
    project,
    domain,
    link,
  }: {
    req: Request;
    params: Record<string, string>;
    searchParams: Record<string, string>;
    headers?: Record<string, string>;
    session: Session;
    project: ProjectProps;
    domain: string;
    link?: LinkProps;
  }): Promise<Response>;
}
export const withAuth =
  (
    handler: WithAuthHandler,
    {
      requiredPlan = ["free", "pro", "business", "enterprise"], // if the action needs a specific plan
      requiredRole = ["owner", "member"],
      needNotExceededClicks, // if the action needs the user to not have exceeded their clicks usage
      needNotExceededLinks, // if the action needs the user to not have exceeded their links usage
      allowAnonymous, // special case for /api/links (POST /api/links) – allow no session
      allowSelf, // special case for removing yourself from a project
      skipLinkChecks, // special case for /api/links/exists – skip link checks
    }: {
      requiredPlan?: Array<PlanProps>;
      requiredRole?: Array<"owner" | "member">;
      needNotExceededClicks?: boolean;
      needNotExceededLinks?: boolean;
      allowAnonymous?: boolean;
      allowSelf?: boolean;
      skipLinkChecks?: boolean;
    } = {},
  ) =>
  async (
    req: Request,
    { params }: { params: Record<string, string> | undefined },
  ) => {
    const searchParams = getSearchParams(req.url);
    const { linkId } = params || {};
    const slug = params?.slug || searchParams.projectSlug;

    const domain = params?.domain || searchParams.domain;
    const key = searchParams.key;

    let session: Session | undefined;
    let headers = {};

    // if there's no projectSlug defined
    if (!slug) {
      if (allowAnonymous) {
        // @ts-expect-error
        return handler({
          req,
          params: params || {},
          searchParams,
          headers,
        });
      } else {
        return new Response(
          "Project slug not found. Did you forget to include a `projectSlug` query parameter?",
          {
            status: 400,
          },
        );
      }
    }

    const authorizationHeader = req.headers.get("Authorization");
    if (authorizationHeader) {
      if (!authorizationHeader.includes("Bearer ")) {
        return new Response(
          "Misconfigured authorization header. Did you forget to add 'Bearer '? Learn more: https://dub.sh/auth ",
          {
            status: 400,
          },
        );
      }
      const apiKey = authorizationHeader.replace("Bearer ", "");

      const url = new URL(req.url || "", API_DOMAIN);

      if (url.pathname.includes("/stats")) {
        return new Response("API access is not available for stats yet.", {
          status: 403,
        });
      }

      const hashedKey = hashToken(apiKey, {
        noSecret: true,
      });

      const user = await prisma.user.findFirst({
        where: {
          tokens: {
            some: {
              hashedKey,
            },
          },
        },
        select: {
          id: true,
          name: true,
          email: true,
        },
      });
      if (!user) {
        return new Response("Unauthorized: Invalid API key.", {
          status: 401,
        });
      }

      const { success, limit, reset, remaining } = await ratelimit(
        10,
        "1 s",
      ).limit(apiKey);

      headers = {
        "Retry-After": reset.toString(),
        "X-RateLimit-Limit": limit.toString(),
        "X-RateLimit-Remaining": remaining.toString(),
        "X-RateLimit-Reset": reset.toString(),
      };

      if (!success) {
        return new Response("Too many requests.", {
          status: 429,
          headers,
        });
      }
      await prisma.token.update({
        where: {
          hashedKey,
        },
        data: {
          lastUsed: new Date(),
        },
      });
      session = {
        user: {
          id: user.id,
          name: user.name || "",
          email: user.email || "",
        },
      };
    } else {
      session = await getSession();
      if (!session?.user?.id) {
        return new Response("Unauthorized: Login required.", {
          status: 401,
          headers,
        });
      }
    }

    const [project, link] = (await Promise.all([
      prisma.project.findUnique({
        where: {
          slug,
        },
        select: {
          id: true,
          name: true,
          slug: true,
          logo: true,
          usage: true,
          usageLimit: true,
          linksUsage: true,
          linksLimit: true,
          domainsLimit: true,
          tagsLimit: true,
          usersLimit: true,
          plan: true,
          stripeId: true,
          billingCycleStart: true,
          createdAt: true,
          users: {
            where: {
              userId: session.user.id,
            },
            select: {
              role: true,
            },
          },
          domains: {
            select: {
              slug: true,
              primary: true,
            },
          },
          metadata: true,
        },
      }),
      linkId
        ? prisma.link.findUnique({
            where: {
              id: linkId,
            },
          })
        : domain && key && key !== "_root"
        ? prisma.link.findUnique({
            where: {
              domain_key: {
                domain,
                key,
              },
            },
          })
        : undefined,
    ])) as [ProjectProps, LinkProps | undefined];

    if (!project || !project.users) {
      // project doesn't exist
      return new Response("Project not found.", {
        status: 404,
        headers,
      });
    }

    // prevent unauthorized access to domains that don't belong to the project
    if (
      domain &&
      !isDubDomain(domain) &&
      !project.domains.find((d) => d.slug === domain)
    ) {
      return new Response("Domain does not belong to project.", {
        status: 403,
        headers,
      });
    }

    // project exists but user is not part of it
    if (project.users.length === 0) {
      const pendingInvites = await prisma.projectInvite.findUnique({
        where: {
          email_projectId: {
            email: session.user.email,
            projectId: project.id,
          },
        },
        select: {
          expires: true,
        },
      });
      if (!pendingInvites) {
        return new Response("Project not found.", {
          status: 404,
          headers,
        });
      } else if (pendingInvites.expires < new Date()) {
        return new Response("Project invite expired.", {
          status: 410,
          headers,
        });
      } else {
        return new Response("Project invite pending.", {
          status: 409,
          headers,
        });
      }
    }

    // project role checks
    if (
      !requiredRole.includes(project.users[0].role) &&
      !(allowSelf && searchParams.userId === session.user.id)
    ) {
      return new Response("Unauthorized: Insufficient permissions.", {
        status: 403,
        headers,
      });
    }

    // clicks usage overage checks
    if (needNotExceededClicks && project.usage > project.usageLimit) {
      return new Response(
        exceededLimitError({
          plan: project.plan,
          limit: project.usageLimit,
          type: "clicks",
        }),
        {
          status: 403,
          headers,
        },
      );
    }

    // links usage overage checks
    if (
      needNotExceededLinks &&
      project.linksUsage > project.linksLimit &&
      (project.plan === "free" || project.plan === "pro")
    ) {
      return new Response(
        exceededLimitError({
          plan: project.plan,
          limit: project.linksLimit,
          type: "links",
        }),
        {
          status: 403,
          headers,
        },
      );
    }

    // plan checks
    if (!requiredPlan.includes(project.plan)) {
      // return res.status(403).end("Unauthorized: Need higher plan.");
      return new Response("Unauthorized: Need higher plan.", {
        status: 403,
        headers,
      });
    }

    // link checks (if linkId or domain and key are provided)
    if ((linkId || (domain && key && key !== "_root")) && !skipLinkChecks) {
      // if link doesn't exist
      if (!link) {
        return new Response("Link not found.", {
          status: 404,
          headers,
        });
      }

      // make sure the link is owned by the project
      if (link.projectId !== project?.id) {
        return new Response("Link not found.", {
          status: 404,
          headers,
        });
      }
    }

    return handler({
      req,
      params: params || {},
      searchParams,
      headers,
      session,
      project,
      domain,
      link,
    });
  };

interface WithSessionHandler {
  ({
    req,
    params,
    searchParams,
    session,
  }: {
    req: Request;
    params: Record<string, string>;
    searchParams: Record<string, string>;
    session: Session;
  }): Promise<Response>;
}

export const withSession =
  (handler: WithSessionHandler) =>
  async (req: Request, { params }: { params: Record<string, string> }) => {
    let session: Session | undefined;
    let headers = {};

    const authorizationHeader = req.headers.get("Authorization");
    if (authorizationHeader) {
      if (!authorizationHeader.includes("Bearer ")) {
        return new Response(
          "Misconfigured authorization header. Did you forget to add 'Bearer '? Learn more: https://dub.sh/auth ",
          {
            status: 400,
          },
        );
      }
      const apiKey = authorizationHeader.replace("Bearer ", "");

      const hashedKey = hashToken(apiKey, {
        noSecret: true,
      });

      const user = await prisma.user.findFirst({
        where: {
          tokens: {
            some: {
              hashedKey,
            },
          },
        },
        select: {
          id: true,
          name: true,
          email: true,
        },
      });
      if (!user) {
        return new Response("Unauthorized: Invalid API key.", {
          status: 401,
        });
      }

      const { success, limit, reset, remaining } = await ratelimit(
        10,
        "1 s",
      ).limit(apiKey);

      headers = {
        "Retry-After": reset.toString(),
        "X-RateLimit-Limit": limit.toString(),
        "X-RateLimit-Remaining": remaining.toString(),
        "X-RateLimit-Reset": reset.toString(),
      };

      if (!success) {
        return new Response("Too many requests.", {
          status: 429,
          headers,
        });
      }
      await prisma.token.update({
        where: {
          hashedKey,
        },
        data: {
          lastUsed: new Date(),
        },
      });
      session = {
        user: {
          id: user.id,
          name: user.name || "",
          email: user.email || "",
        },
      };
    } else {
      session = await getSession();
      if (!session?.user.id) {
        return new Response("Unauthorized: Login required.", { status: 401 });
      }
    }

    const searchParams = getSearchParams(req.url);
    return handler({ req, params, searchParams, session });
  };

// Internal use only (for admin portal)
interface WithAdminHandler {
  ({
    req,
    params,
    searchParams,
  }: {
    req: Request;
    params: Record<string, string>;
    searchParams: Record<string, string>;
  }): Promise<Response>;
}

export const withAdmin =
  (handler: WithAdminHandler) =>
  async (req: Request, { params }: { params: Record<string, string> }) => {
    if (!(await isAdmin())) {
      return new Response("Unauthorized: Not an admin.", { status: 401 });
    }

    const searchParams = getSearchParams(req.url);
    return handler({ req, params, searchParams });
  };
