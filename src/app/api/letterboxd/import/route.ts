import { NextResponse } from "next/server";
import {
  importLetterboxdMovies,
  LetterboxdImportException,
  type LetterboxdImportError
} from "@/lib/letterboxd";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const username = typeof body?.username === "string" ? body.username : "";
    const result = await importLetterboxdMovies(username);

    return NextResponse.json(result);
  } catch (error) {
    const importError = toApiError(error);

    if (
      importError.code !== "EMPTY_USERNAME" &&
      importError.code !== "USER_NOT_FOUND" &&
      importError.code !== "PRIVATE_PROFILE" &&
      importError.code !== "NO_MOVIES_FOUND"
    ) {
      console.error("Letterboxd import failed", error);
    }

    return NextResponse.json(importError, {
      status: getStatusCode(importError.code)
    });
  }
}

function toApiError(error: unknown): LetterboxdImportError {
  if (error instanceof LetterboxdImportException) {
    return {
      code: error.code,
      message: error.message
    };
  }

  return {
    code: "UNKNOWN_ERROR",
    message: "Something went wrong while importing this Letterboxd profile."
  };
}

function getStatusCode(code: LetterboxdImportError["code"]): number {
  switch (code) {
    case "EMPTY_USERNAME":
      return 400;
    case "USER_NOT_FOUND":
      return 404;
    case "PRIVATE_PROFILE":
      return 403;
    case "NO_MOVIES_FOUND":
      return 422;
    default:
      return 502;
  }
}
