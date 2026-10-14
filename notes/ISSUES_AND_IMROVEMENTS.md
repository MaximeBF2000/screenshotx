# Issues I found while testing the software

- In the Quick access, when taking a lot of screenshots and leaving them in quick access they accumulate and they leave screen at some point with no way to access the first ones. Also there is no way to hide them temporarily (in Cleanshot user can do a mouse gesture to hide them ⇒ They go down the screen and there is an arrow there that is clickable or the user can do the opposite mouse gesture to make them reappear. Also I don't know how Cleanshot manages having too much screenshots, I assume a scroll but not sure. => What I want is for you to take a look at how Cleanshot handles those two features (you can first take a look online / their docs and if you don't find the proper info then reverse engineer it from the installed "Cleanshot X.app". Please implement those and report back on how you handled it

- Looks like either when the computer is locked or put in sleep mode, then unlocked/turned back on, the software does not really work anymore, I am unable to go in screenshot mode again. Please investigate and fix this

- Currently when drap-and-dropping images/videos from the quick access it leaves the quick access, I want this to stay in the quick access
