import type { Lang } from './types'

export const SAMPLES: Record<Lang, [string, string]> = {
  json: [
    '{"id":1024,"name":"Aarav Sharma","email":"aarav@example.com","active":true,"roles":["admin","editor"],"address":{"city":"Pune","zip":"411001"},"balance":1520.75,"tags":[]}',
    '{"id":1024,"name":"Aarav Sharma","email":"aarav.sharma@example.com","active":false,"roles":["admin","viewer"],"address":{"city":"Mumbai","zip":"400001","country":"IN"},"balance":1520.75,"lastLogin":"2026-11-02T10:15:00Z"}',
  ],
  xml: [
    '<?xml version="1.0" encoding="UTF-8"?><catalog><book id="bk101" lang="en"><author>Gambardella, Matthew</author><title>XML Developer\'s Guide</title><price>44.95</price><publish_date>2000-10-01</publish_date></book><book id="bk102"><author>Ralls, Kim</author><title>Midnight Rain</title><price>5.95</price></book></catalog>',
    '<?xml version="1.0" encoding="UTF-8"?><catalog><book id="bk101" lang="en-US"><author>Gambardella, Matthew</author><title>XML Developer\'s Guide, 2nd Edition</title><price>49.95</price><publish_date>2001-10-01</publish_date></book><book id="bk102"><author>Ralls, Kim</author><title>Midnight Rain</title><price>5.95</price><stock available="true"/></book></catalog>',
  ],
  sql: [
    `CREATE PROCEDURE dbo.usp_GetOrders
  @CustomerId INT,
  @FromDate DATE = NULL
AS
BEGIN
  SET NOCOUNT ON;

  SELECT o.OrderId,
    o.OrderDate,
    o.Total
  FROM dbo.Orders o
  WHERE o.CustomerId = @CustomerId
    AND o.OrderDate >= ISNULL(@FromDate, DATEADD(DAY, -30, GETDATE()))
  ORDER BY o.OrderDate DESC;
END`,
    `CREATE PROCEDURE dbo.usp_GetOrders
  @CustomerId INT,
  @FromDate DATE = NULL,
  @Status VARCHAR(20) = 'Open'
AS
BEGIN
  SET NOCOUNT ON;

  SELECT o.OrderId,
    o.OrderDate,
    o.Total,
    c.Name AS CustomerName
  FROM dbo.Orders o
  INNER JOIN dbo.Customers c ON c.CustomerId = o.CustomerId
  WHERE o.CustomerId = @CustomerId
    AND o.Status = @Status
    AND o.OrderDate >= ISNULL(@FromDate, DATEADD(DAY, -90, GETDATE()))
  ORDER BY o.OrderDate DESC;
END`,
  ],
  text: [
    `Release notes - v2.3

- Added dark mode
- Improved search performance
- Fixed login timeout on slow networks

Known issues:
Export to PDF may fail for large reports.`,
    `Release notes - v2.4

- Added dark mode
- Improved search performance by 40%
- Fixed login timeout on slow networks
- Added CSV export

Known issues:
None.`,
  ],
}
