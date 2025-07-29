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
    corresponding: true # (This is how to denote the corresponding author)
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
    equal-contrib: true
    affiliation: 3
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

In 2004, the European Space Agency's Rosetta mission launched to gather information on Comet 67P/Churyumov-Gerasimenko. This 11 year mission took decades to plan and complete, cost roughly 2 billion dollars, and relied upon the close cooperation of numerous countries. One of Rosetta's sensors, the OSIRIS Narrow Angle Camera, took tens of thousands of the most detailed images of 67P, and these images provide one of the most important data sets to-date for studying comets.

However, sifting through the huge collection of images to find those that relate to a particular location on the comet or feature has been a daunting and time consuming task. Because Rosetta had an irregular and changing orbit, it is difficult to predict which images might have captured a particular feature.

To facilitate the process of finding relevant images, we have built a tool called `Comet.Photos`. The user can manipulate a 3D shape model of 67P, paint a region of interest, and rapidly find all of the images that contain it. These images can then be easily browsed, or the list of images can be downloaded for further study in another tool. Images can be further filtered on other properties, relating to the relative locations of the Rosetta probe, the surface, and the sun.

# Statement of need

The European Space Agency’s (ESA) Rosetta mission to Comet 67P/Churyumov-Gerasimenko (hereafter, 67P) provided the most comprehensive dataset for a comet to date. Its OSIRIS camera suite [@keller2007] returned nearly 100,000 high-resolution images, providing unprecedented spatial and temporal coverage of a cometary surface. This extensive dataset enables a diverse range of analyses for regions of interest on the comet. Multiple images of the same area can be leveraged for photometric studies [@oklay2016; @fornasier2023] used to derive estimates of the local topography through techniques like photoclinometry [@jindal2024], or examined over time to track surface evolution and understand how cometary landscapes change [@barrington2023; @jindal2022; @birch2019; @elmaary2017; @fornasier2017; @keller2017; @groussin2015]. However, as noted by [@barrington2023], identifying relevant images for such analyses is a highly challenging and time-consuming task, requiring a manual search through ESA’s Planetary Science Archive (PSA). This difficulty is further compounded by Rosetta’s variable orbit around 67P, which often results in images of the same region appearing vastly different from one another. Efforts have been made to mitigate these challenges—for example, ESA has introduced an image search capability within the PSA. 

However, this tool remains inadequate (at least for Rosetta), as it (a) is still slow, (b) frequently returns incorrect data, and (c) lacks user control over filtering searches by image parameters, a crucial feature for assembling a manageable dataset without wasting time removing irrelevant images. Hence, To fully harness the scientific potential of Rosetta’s vast dataset and empower researchers to quickly and accurately identify relevant observations for analysis, an efficient and intuitive tool is needed to streamline image retrieval. 

`Comet.Photos` has been developed to fill this critical gap, providing a powerful solution for spatially targeted image searches and facilitating detailed studies of cometary surface evolution. Users can define a region of interest by interactively selecting the desired region on a 3D model of 67P. In a fraction of a second, the application searches through over 27,000 NAC images to find only those that feature the selected region. In addition to this spatial search filter, `Comet.Photos` allows users to filter images based on their resolution and viewing geometry. To search only images with a fine spatial resolution, users can filter by the image resolution, which represents the linear scale of a pixel on the surface. Three other parameters of interest from a photometric and surface standpoint are the emission angle (the angle between the camera and surface normal), incidence angle (the angle between the Sun and the surface normal), and phase angle (the solid angle between the Sun and camera at the surface). All three of these can be filtered as well. Images matching the search criteria can be displayed in the application, either in their original 2D form or projected onto the 3D model. At the end of a session with `Comet.Photos`, a list containing the IDs of the filtered images can also be downloaded, allowing further analysis with external tools.


# Software architecture and performance

The software was architected such that it can run locally for maximal performance, or on the web, for greater accessibility. To access the program on the web, requiring no software installation, visit https://comet.photos. Instructions for installing the program locally are available at [XXXX]. When running `Comet.Photos` on a modern computer, all functions, including search and image display, take a small fraction of a second, but also require approximate 14GB of local files (mostly images). The program was architected to also have acceptable performance over the internet. Further information on `Comet.Photo`'s architecture is documented at [@kurlander2025github].

# The user interface

A user manual for `Comet.Photos` is available at https://https://comet.photos/quickstart.html. We also describe a brief session with `Comet.Photos` to more thoroughly document its use. 


# Figures

Figures can be included like this:
![Caption for example figure.\label{fig:example}](figure.png)
and referenced from text using \autoref{fig:example}.

Figure sizes can be customized by adding an optional second parameter:
![Caption for example figure.](figure.png){ width=20% }

# Acknowledgements

The European Space Agency's Rosetta mission provided the incredible image dataset [@esa2018rosetta; @esa2024image; @esa2024psa] on which `Comet.Photos` operates. Additional tools extracted metadata from the image dataset [@usgs2023isis] or allowed us to calculate additional information [@esa2022spice] which is needed for `Comet.Photos`' search algorithm. The 3D shape model used by `Comet.Photos` is based on the SHAP7 model [@preusker2017shape] and was provided by [@vincent2021shapeviewer]. A number of great software tools and components facilitated the development of Comet.photos [@cabello2023threejs; @vincent2018shapeviewer;  @johnson2023bvh; @fugaro2023threeprojected; @salmen2023objloader2; @martignene2024koffi; @rauch2024socketio; @openjs2024node].
 
This research was supported by the Discovery Data Analysis Program (#xxxxxxxxx to J.M.S.), the Heising-Simons Foundation (51 Pegasi b Fellowship to S.P.D.B.), and the MIT UROP Program. We gratefully acknowledge Jean-Baptiste Vincent, discussions with whom made this software possible as he helped us navigate Rosetta’s dataset. A 2023 MIT Open Data Prize for an earlier version of this work also provided recognition and encouragement to continue developing Comet.photos [@fay2023opendata]. Lastly, we thank all the early users of the program for feedback that led to improvements.  


# References