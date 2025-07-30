---
title: 'Comet.Photos: An Interactive Tool for Rapidly Searching and Displaying Rosetta Mission Images by Spatial Location and Other Properties'
tags:
  - Rosetta
  - astronomy
  - comets
  - spatial search
  - OSIRIS camera
authors:
  - name: Daniel A. Kurlander
    orcid: 0009-0009-6828-3266
    equal-contrib: true
    affiliation: 1
  - name: Jason M. Soderblom
    equal-contrib: true
    affiliation: 1
  - name: Abhinav S. Jindal
    equal-contrib: true
    affiliation: 2
  - name: Samuel P. D. Birch
    equal-contrib: true
    affiliation: 2
  - name: David J. Kurlander
    orcid: 0009-0008-9551-7243
    equal-contrib: true
    affiliation: 3
    corresponding: true
affiliations:
 - name: Department of Earth, Atmospheric and Planetary Sciences, Massachusetts Institute of Technology, United States
   index: 1
   ror: 042nb2s44
 - name: Department of Earth, Environmental and Planetary Sciences, Brown University, United States
   index: 2
   ror: 05gq02987
 - name: Independent Researcher, Seattle, Washington, United States
   index: 3
date: 26 July 2025
bibliography: paper.bib

# Optional fields if submitting to a AAS journal too, see this blog post:
# https://blog.joss.theoj.org/2018/12/a-new-collaboration-with-aas-publishing
# aas-doi: 10.3847/xxxxx <- update this with the DOI from AAS once you know it.
# aas-journal: Astrophysical Journal <- The name of the AAS journal.
---

# Summary

The Rosetta spacecraft, launched by the European Space Agency to orbit Comet 67P/Churyumov-Gerasimenko (hereafter 67P), captured a vast collection of scientifically significant photographs. Specifically one of Rosetta's sensors, the OSIRIS Narrow Angle Camera (NAC), took tens of thousands of the most detailed images of 67P, and these images provide one of the most important data sets to-date for studying comets.

Comet researchers frequently spend hours manually scanning this massive collection of images to locate those that capture a particular region of interest. However, sifting through the 27,000+ images in the collection is an error prone and tedious task.

To facilitate the process of finding relevant images, we have built a tool called `Comet.Photos`. The user manipulates a 3D shape model of 67P, selects a region of interest, and the program rapidly finds all of the images that contain this region. These images can easily be browsed in their original 2D form or projected onto the 3D model. Images can be further filtered according to other properties, relating to the relative locations of the Rosetta probe, the surface of the comet, and the Sun.

# Statement of need

The ESA's Rosetta mission to 67P provided the most comprehensive dataset for a comet to date. The Narrow Angle Camera of the OSIRIS camera suite [@keller2007] returned an immense corpus of the most detailed high-resolution images, providing unprecedented spatial and temporal coverage of a cometary surface. This extensive dataset enables a diverse range of analyses for regions of interest on the comet. Multiple images of the same area can be leveraged for photometric studies [@oklay2016; @fornasier2023], used to derive estimates of the local topography through techniques like photoclinometry [@jindal2024], or examined over time to track surface evolution and understand how cometary landscapes change [@barrington2023; @jindal2022; @birch2019; @elmaary2017; @fornasier2017; @keller2017; @groussin2015]. However, as noted in [@barrington2023], identifying relevant images for such analyses is a highly challenging and time-consuming task, requiring a manual search through ESA’s Planetary Science Archive (PSA). This difficulty is further compounded by Rosetta’s variable orbit around 67P, which often results in images of the same region appearing vastly different from one another.

Efforts have been made to mitigate these challenges — for example, ESA has introduced an image search capability within the PSA [@esa2024psa]. However, this tool remains inadequate (at least for Rosetta), as it (a) is still slow, (b) frequently returns incorrect data, and (c) lacks user control over filtering searches by image parameters, a crucial feature for assembling a manageable dataset without wasting time removing irrelevant images. Hence, To fully harness the scientific potential of Rosetta’s vast dataset and empower researchers to quickly and accurately identify relevant observations for analysis, an efficient and intuitive tool is needed to streamline image retrieval. 

`Comet.Photos` has been developed to fill this critical gap, providing a powerful solution for spatially targeted image searches and facilitating detailed studies of cometary surface evolution. Users can choose a region of interest by interactively selecting the desired region on a 3D model of 67P. In a fraction of a second, the application searches through over 27,000 NAC images to find only those that feature the selected region. In addition to this spatial search filter, `Comet.Photos` allows users to filter images based on their resolution and viewing geometry. To retrieve only the most detailed images, users can filter by spatial resolution, representing the linear scale of a pixel on the surface. Three other parameters of interest from a photometric and surface standpoint are the emission angle (the angle between the camera and surface normal), incidence angle (the angle between the Sun and the surface normal), and phase angle (the solid angle between the Sun and camera at the surface). All three of these can be filtered as well. Images matching the search criteria can be displayed in the application, either in their original 2D form or projected onto the 3D model. At the end of a session with `Comet.Photos`, a list containing the IDs of the filtered images can also be downloaded, allowing further analysis with external tools.

Although designed for scientists, `Comet.Photos` is also a very user-friendly way for astronomy instructors, students, or anyone interested in the solar system to explore Rosetta's extraordinary images of 67P. Scientists expecting to make frequent use of `Comet.Photos` will want to install it locally, as then all functions, including search and image display, take only a small fraction of a second running on a modern computer. People casually interested in the program can access it on the web, requiring absolutely no software installation, simply by visiting https://comet.photos.

# Program details

Additional information is available at the `Comet.Photos` github repository [@kurlander2025github], including:

>  - [A user manual](https://github.com/comet-dot-photos/comet-dot-photos#user-manual)
>  - [A step-by-step example of using the program](https://github.com/comet-dot-photos/comet-dot-photos#step-by-step-example).
>  - [Instructions for installing the program locally](https://github.com/comet-dot-photos/comet-dot-photos#installing-locally)
>  - [A description of the architecture](https://github.com/comet-dot-photos/comet-dot-photos#architecture)
>  - [A discussion of program performance](https://github.com/comet-dot-photos/comet-dot-photos#performance)

# Acknowledgements

The ESA's Rosetta mission provided the remarkable image dataset [@esa2018rosetta; @esa2024image; @esa2024psa] on which `Comet.Photos` operates. Additional tools helped us extract or calculate necessary metadata from the image dataset [@usgs2023isis, @esa2022spice]. The 3D shape model used by `Comet.Photos` is based on the SHAP7 model [@preusker2017shape] and was provided by [@vincent2021shapeviewer]. A number of great software tools and components facilitated the development of `Comet.Photos` [@cabello2023threejs; @vincent2021shapeviewer; @johnson2023bvh; @fugaro2023threeprojected; @salmen2023objloader2; @martignene2024koffi; @rauch2024socketio; @openjs2024node].
 
This research was supported by the Discovery Data Analysis Program (#xxxxxxxxx to J.M.S.), the Heising-Simons Foundation (51 Pegasi b Fellowship to S.P.D.B.), and the MIT UROP Program. A 2023 MIT Open Data Prize for an earlier version of this work also provided recognition and encouragement to continue developing `Comet.Photos`[@fay2023opendata]. We gratefully acknowledge Jean-Baptiste Vincent, discussions with whom made this software possible as he helped us navigate Rosetta’s dataset.  

# References