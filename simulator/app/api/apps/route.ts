// The developer's apps on Bankroll, shown on the home screen beside the ones
// added by hand. Not wired to the Bankroll api yet: return each app's address
// here, as "https://br-17-a18mds.vercel.app", and it gets an icon.
export async function GET() {
  const apps: string[] = [];
  return Response.json({ apps });
}
