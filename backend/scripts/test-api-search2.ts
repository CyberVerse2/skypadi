async function main() {
  const searchRes = await fetch("https://flights.wakanow.com/api/flights/Search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/plain, */*",
      "Origin": "https://www.wakanow.com",
      "Referer": "https://www.wakanow.com/",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    },
    body: JSON.stringify({
      FlightSearchType: "OneWay",
      Ticketclass: "Y",
      FlexibleDateFlag: false,
      Adults: 1,
      Children: 0,
      Infants: 0,
      GeographyId: "NG",
      TargetCurrency: "NGN",
      LanguageCode: "en",
      Itineraries: [{
        Ticketclass: "Y",
        Departure: "LOS",
        Destination: "ABV",
        DepartureDate: "4/25/2026"
      }]
    })
  });

  const requestKey = (await searchRes.text()).replace(/"/g, "");
  console.log("Key:", requestKey);

  const apiRes = await fetch(
    `https://flights.wakanow.com/api/flights/SearchV2/${requestKey}/NGN`,
    {
      headers: {
        "Accept": "application/json",
        "Origin": "https://www.wakanow.com",
        "Referer": "https://www.wakanow.com/"
      }
    }
  );

  console.log("Status:", apiRes.status);
  const text = await apiRes.text();

  if (!text.startsWith("{")) {
    console.log("Not JSON:", text.slice(0, 200));
    return;
  }

  const data = JSON.parse(text);
  const first = data.SearchFlightResults?.[0];
  if (first) {
    console.log(JSON.stringify(first, null, 2));
  } else {
    console.log("No results. Keys:", Object.keys(data));
  }
}

main().catch(console.error);
