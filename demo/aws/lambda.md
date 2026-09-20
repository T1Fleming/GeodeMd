# Lambda

Notes from getting the ingest pipeline working. Most of this was learned the
annoying way.

## Limits

The defaults are conservative and the failure modes are not obvious, so these
are worth knowing cold.

Default Lambda timeout :: 3 seconds
- Maximum Lambda timeout :: 15 minutes
- Maximum memory for a Lambda function :: 10240 MB

Memory and CPU are not configured separately — you buy CPU by buying memory,
which is why a function doing heavy work can get *cheaper* by being given more
memory. It finishes faster.

What does raising a Lambda's memory also raise :: its CPU allocation, proportionally

## Cold starts

What causes a Lambda cold start :: a request arriving with no warm execution environment available

The first invocation after a deploy is always cold. So is the first after a
period of no traffic, and so is any invocation that has to scale out past the
number of warm environments.

- Which language runtimes have the worst cold starts :: JVM and .NET, because the runtime itself has to initialise
- What runs during a cold start but not a warm one :: the init phase — module imports and anything at the top level of your handler file

Anything expensive at module scope is paid once per *environment*, not once
per request. That is the whole trick behind putting a database connection
there.
