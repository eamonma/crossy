import { withSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { redis } from "@/lib/upstash";
import cloudinary from "cloudinary";
import { NextResponse } from "next/server";

// GET /api/user – get a specific user
export const GET = withSession(async ({ session }) => {
  const migratedProject = await redis.hget(
    "migrated_links_users",
    session.user.id,
  );

  return NextResponse.json({
    ...session.user,
    migratedProject,
  });
});

// PUT /api/user – edit a specific user
export const PUT = withSession(async ({ req, session }) => {
  let { name, email, image } = await req.json();
  try {
    if (image) {
      const { secure_url } = await cloudinary.v2.uploader.upload(image, {
        public_id: session.user.id,
        folder: "avatars",
        overwrite: true,
        invalidate: true,
      });
      image = secure_url;
    }
    const response = await prisma.user.update({
      where: {
        id: session.user.id,
      },
      data: {
        ...(name && { name }),
        ...(email && { email }),
        ...(image && { image }),
      },
    });
    return NextResponse.json(response);
  } catch (error) {
    if (error.code === "P2002") {
      // return res.status(422).end("Email is already in use.");
      return new Response("Email is already in use.", { status: 422 });
    }
    return new Response(error.message, { status: 500 });
  }
});

// DELETE /api/user – delete a specific user
export const DELETE = withSession(async ({ session }) => {
  const userIsOwnerOfProjects = await prisma.projectUsers.findMany({
    where: {
      userId: session.user.id,
      role: "owner",
    },
  });
  if (userIsOwnerOfProjects.length > 0) {
    return new Response(
      "You must transfer ownership of your projects or delete them before you can delete your account.",
      { status: 422 },
    );
  } else {
    const response = await Promise.allSettled([
      prisma.user.delete({
        where: {
          id: session.user.id,
        },
      }),
      cloudinary.v2.uploader.destroy(`avatars/${session?.user?.id}`, {
        invalidate: true,
      }),
      fetch(
        `https://api.resend.com/audiences/${process.env.RESEND_AUDIENCE_ID}/contacts/${session?.user?.email}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
        },
      ),
    ]);
    return NextResponse.json(response);
  }
});
