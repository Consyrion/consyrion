import { NextResponse } from "next/server";
import { openApiDocument } from "@/lib/openapi";

/** Public API description (#101); contains no data and no secrets. */
export const GET = () => NextResponse.json(openApiDocument);
