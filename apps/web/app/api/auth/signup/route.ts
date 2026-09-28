import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@alpha/db";

export async function POST(req: Request) {
  try {
    const body = await req.json() as { email?: string; password?: string; name?: string };
    const { email, password, name } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required." },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters." },
        { status: 400 }
      );
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json(
        { error: "An account with this email already exists." },
        { status: 409 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.create({
      data: { email, name: name ?? null, passwordHash },
    });

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (err) {
    console.error("[signup]", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
