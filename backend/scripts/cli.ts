import { flightSearchRequestSchema } from "../src/schemas/flight-search.js";
import { WakanowSearchError, searchWakanowFlights } from "../src/services/wakanow/search.js";

type ParsedArgs = Record<string, string | boolean>;

const usage = `SkyPadi CLI

Usage:
  npm run cli -- --origin LOS --destination DXB --departure 2026-06-10 [options]

Options:
  --origin <code>           Origin airport/city code
  --destination <code>      Destination airport/city code
  --departure <date>        Departure date in YYYY-MM-DD
  --return <date>           Return date in YYYY-MM-DD
  --max-results <n>         Max results to return, default 10
  --timeout-ms <n>          Override timeout in milliseconds
  --headed                  Launch browser in headed mode
  --verbose                 Print step-by-step scraper logs
  --debug                   Print error details JSON
  --json                    Print raw JSON instead of a summary
  --help                    Show this help
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(usage);
    return;
  }

  const payload = flightSearchRequestSchema.parse({
    origin: getRequiredString(args, "origin"),
    destination: getRequiredString(args, "destination"),
    departureDate: getRequiredString(args, "departure"),
    returnDate: getOptionalString(args, "return"),
    maxResults: getNumber(args, "max-results", 10),
    timeoutMs: getOptionalNumber(args, "timeout-ms"),
    headless: !Boolean(args.headed)
  });

  const verbose = Boolean(args.verbose || args.debug);
  const result = await searchWakanowFlights(payload, {
    onTrace: verbose
      ? (event) => {
          const details = event.data ? ` ${JSON.stringify(event.data)}` : "";
          console.error(`[trace ${event.timestamp}] ${event.step} ${event.message}${details}`);
        }
      : undefined
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printSummary(result);
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];

    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }

    parsed[key] = next;
    index += 1;
  }

  return parsed;
}

function getRequiredString(args: ParsedArgs, key: string) {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing required argument --${key}\n\n${usage}`);
  }

  return value.trim();
}

function getOptionalString(args: ParsedArgs, key: string) {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getNumber(args: ParsedArgs, key: string, fallback: number) {
  const value = args[key];
  if (typeof value !== "string") {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid number for --${key}: ${value}`);
  }

  return parsed;
}

function getOptionalNumber(args: ParsedArgs, key: string) {
  const value = args[key];
  if (typeof value !== "string") {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid number for --${key}: ${value}`);
  }

  return parsed;
}

function printSummary(result: Awaited<ReturnType<typeof searchWakanowFlights>>) {
  console.log(`Provider: ${result.provider}`);
  console.log(`Results: ${result.resultCount}`);
  console.log(`Searched at: ${result.searchedAt}`);
  console.log("");

  if (result.results.length === 0) {
    console.log("No results returned.");
    return;
  }

  for (const [index, flight] of result.results.entries()) {
    console.log(`#${index + 1}`);
    console.log(`Airline: ${flight.airline ?? "Unknown"}`);
    console.log(`Price: ${flight.priceText ?? "Unknown"}`);
    console.log(`Times: ${flight.departureTime ?? "?"} -> ${flight.arrivalTime ?? "?"}`);
    console.log(`Duration: ${flight.duration ?? "Unknown"}`);
    console.log(`Stops: ${flight.stops ?? "Unknown"}`);
    console.log("");
  }
}

try {
  await main();
} catch (error) {
  const args = parseArgs(process.argv.slice(2));

  if (error instanceof WakanowSearchError) {
    console.error(`Wakanow search failed: ${error.message}`);
    if (args.debug && error.details) {
      console.error(JSON.stringify(error.details, null, 2));
    }
    process.exitCode = 2;
  } else if (error instanceof Error) {
    console.error(error.message);
    process.exitCode = 1;
  } else {
    console.error("Unknown CLI error");
    process.exitCode = 1;
  }
}
