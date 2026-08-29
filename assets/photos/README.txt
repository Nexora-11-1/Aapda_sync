DROP PHOTOGRAPHS HERE
=====================

The record carousel looks for a file named after each event id and uses it
instead of the drawn scene. If the file is absent the drawing is used, so
this folder can stay empty.

    R-1984.jpg   Bhopal, 3 December 1984
    R-1999.jpg   Odisha super cyclone, 29 October 1999
    R-2001.jpg   Bhuj earthquake, 26 January 2001
    R-2013.jpg   Kedarnath / North India floods, June 2013
    R-2018.jpg   Kerala floods, July-August 2018
    R-2021.jpg   Chamoli, 7 February 2021

.jpg, .png and .webp all work. Landscape crops around 1200x570 look best.

WHERE TO GET THEM
-----------------
Wikimedia Commons has freely licensed images for all six events. Open the
category, choose a file, and use the "Original file" link on its page:

    https://commons.wikimedia.org/wiki/Category:Bhopal_disaster
    https://commons.wikimedia.org/wiki/Category:1999_Odisha_cyclone
    https://commons.wikimedia.org/wiki/Category:2001_Gujarat_earthquake
    https://commons.wikimedia.org/wiki/Category:2013_North_India_floods
    https://commons.wikimedia.org/wiki/Category:2018_Kerala_floods
    https://commons.wikimedia.org/wiki/Category:2021_Uttarakhand_flood

NASA and NOAA satellite imagery of these events is public domain and is the
safest choice: no licence conditions, and it shows the hazard rather than the
people it happened to.

CREDIT IS NOT OPTIONAL
----------------------
Most Commons images are CC BY or CC BY-SA and legally require attribution.
Open src/record.js and fill in the `credit` field on the matching entry:

    credit: 'Photo: A. Sharma, CC BY-SA 4.0, via Wikimedia Commons'

The carousel prints whatever is in `credit` over the bottom-right of the
image. An uncredited CC BY image is a licence breach, so an entry with a
photo and no credit will log a warning to the console.

Photos load from the unpacked folder build only. The single-file build and
the hosted artifact cannot reach a relative path, and both fall back to the
drawn scene automatically.
