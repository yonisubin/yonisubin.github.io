<!DOCTYPE html>
<html>
<head>
    <?php
        $visits = json_decode(file_get_contents("visits.json"), true);
        array_push($visits, date("Y-m-d h:i:sa"));
        $jsonString=json_encode($visits);
        $fp = fopen("visits.json", 'w');
        fwrite($fp, $jsonString);
        fclose($fp);
    ?>
    <title>Yoni Subin</title>
    <meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<!-- Latest compiled and minified CSS -->
	<link rel="stylesheet" href="https://maxcdn.bootstrapcdn.com/bootstrap/4.5.0/css/bootstrap.min.css">

	<!-- jQuery library -->
	<script src="https://ajax.googleapis.com/ajax/libs/jquery/3.5.1/jquery.min.js"></script>

	<!-- Popper JS -->
	<!-- <script src="https://cdnjs.cloudflare.com/ajax/libs/popper.js/1.16.0/umd/popper.min.js"></script> -->

	<!-- Latest compiled JavaScript -->
	<script src="https://maxcdn.bootstrapcdn.com/bootstrap/4.5.0/js/bootstrap.min.js"></script>
    <style>
        /*#about,*/ #resume, #courses, #projects{
            display:none
        }
        #about:target, #resume:target, #courses:target, #projects:target{
            padding-top: 80px;
            display:block
        }
        #resume-head{
            text-align: center;
        }
        .resume-section-title{
            padding:15px
        }
        .resume-section{
            padding:30px
        }
        table td{
            border:2px black solid;
            text-align:center;
        }
        header{
            position: -webkit-sticky;
            position: sticky;
            top:0;
            z-index: 1020;
            width:100%;
        }
        .sudoku-number{
            width:40px;
            height:40px;
        }
        #sudoku-board{
            display:inline;
        }
        #sudoku-solve{
            display: inline;
            margin-left:100px;
            margin-right:100px
        }
        #sudoku-solution{
            display:inline;
        }
        .sudoku-sol-num{
            width:40px;
            height:40px
        }
        #hangman #word-space{
            float: left;
            
        }
        #hangman #draw-space{
            float: left;
        }
        #hangman-drawing{
            padding:10px;
            margin:10px;
        }
        .project{
            display: block;
        }
        #snake-canvas{
            border:2px solid black;
            height: 500px;
            width:500px;
        }
        figure{
            margin:10px
        }
    </style>
    <script>
        $(document).ready(function(){
            $(".nav-btn").click(function(e){
                // console.log("Id: "+(e.target.id));
                for(i=0;i<$(".nav-btn").length;i++){
                    if($(".nav-btn")[i].id==e.target.id){
                        $(e.target.id).show();
                    }else{
                        $($(".nav-btn")[i].id).hide();
                    }
                }
            });
        });
    </script>

</head>
<body>
    <header class="p-3 text-bg-dark" style="border:2px solid;border-radius: 20px;background-color: #aaaa;">
        <div class="container">
            <div class="d-flex flex-wrap align-items-center justify-content-center justify-content-lg-start">
                <a href="." class="d-flex align-items-center mb-2 mb-lg-0 text-white text-decoration-none"><img src="personal-logo.png" style="height:50px;"/></a>
                <ul class="nav col-12 col-lg-auto me-lg-auto mb-2 justify-content-center mb-md-0">
                    <li><a id="#about" href="#about" class="nav-link px-2 text-secondary nav-btn">About</a></li>
                    <li><a id="#resume" href="#resume" class="nav-link px-2 text-secondary nav-btn">Resume</a></li>
                    <li><a id="#courses" href="#courses" class="nav-link px-2 text-secondary nav-btn">Courses</a></li>
                    <li><a id="#projects" href="#projects" class="nav-link px-2 text-secondary nav-btn">Projects</a></li>
                </ul>
                <div class="text-end col-7" style="text-align:right">
                    <a href="./he/"><img src="he-il.png" style="height: 15px;"/></a>
                </div>
            </div>
        </div>
    </header>
    <div id="about">
        <p>
            
        <figure style="float:right">
            <img src="skating_photo.jpg" height="150px" style="float:center"/>
            <figcaption>2015 ISU World Junior Championships</figcaption>
        </figure>
            My name is Yoni Subin and I am a student at Hebrew University of Jerusalem studying Electrical Engeneering and Applied Physics.
            I grew up in Maryland. In high school, I was an international speedskater ranking as high as <a href="https://shorttrack.sportresult.com/Results.aspx?evt=11213100000008&gen=m&ref=15043&view=ocl">45<sup>th</sup> in the world in 2014</a>.
            Growing up, I always had an interest in computers and electricity. I taught myself to code on the internet when I was in middle school. When I
            began high school I took every programming class that I could. I finished AP Computer Science with the highest possible grade and comtinued onto the already-defunct 
            AP Computer Science 2 course.
        </p>
        <p>
            <figure style="float:left">
                <img src="tank_photo.jpg" height="150px"/>
                <figcaption style="text-align:center">My tank crew and I on the <br/> Lebanese border at the start of <br/>the operation</figcaption>
            </figure>
            After high school, I moved to Israel and drafted to the IDF where I served as a Merkava Mk3 Baz Gen D tank driver. I was deployed to 
            Hebron, Bethlehem, Egypt and Lebanon where I participated in <a href="https://en.wikipedia.org/wiki/Operation_Northern_Shield">Operation Northern Shield</a>. 
        </p>
        <p>
            Upon being relased, I began Hebrew University's program for immigrants to help prepare for studies in Israeli universities. I was in the math/science track and 
            finished succefully with an average of 99.97% getting me into Hebrew University's new Electrical Engineering and Applied Physics program.
        </p>
        <p>
            I am skilled in HTML/CSS, JavaScript, Java, Python, and PHP. Check out some of my projects on my projects page.
        </p>
        <p>
            Check out my Linkedin at <a href="https://www.linkedin.com/in/yoni-subin/">linkedin.com/in/yoni-subin/</a>
        </p>
    </div>
    <script>
        if(window.location.toString().indexOf("#")>0 && !window.location.toString().endsWith("#about")){
                $("#about").hide();
            }
    </script>
    <div id="resume">
        <div id="resume-head">
            <h3>Yonaton Subin</h3>
            <h6>Jerusalem, Israel</h6>
            <h6><a href="tel:+9720585633869">+972-58-563-3869</a></h6>
            <h6><a href="mailto:yoni.subin@gmail.com">yoni.subin@gmail.com</a></h6>
        </div>
        <div class="resume-section-title">
                <span style="font-weight:bold">Education:</span>
            <div class="resume-section">
                Hebrew University, Electrical Engineering & Applied Physics (Class of 2025)   
            <ul>
                <li>Classes include Infintecimal Calculus, Mechanics and Special Relativity, and Electricity and Magnetism</li>
            </ul>
            </div>
        </div>
        <div class="resume-section-title">
            <span style="font-weight:bold">Programming Languages</span>
        </div>
        <div class="resume-section">
            <ul>
                <li>Java 7 - 4 years of experience</li>
                <li>Python 3 - 3 years of experience</li>
                <li>HTML5/CSS3/JavaScript - 2 years of experience</li>
            </ul>
        </div>
        <div class="resume-section-title">
            <span style="font-weight:bold">Military Service</span>
        </div>
        <div class="resume-section">
            IDF Sargent First Class in the 53rd “Storm” Armored Battalion (2017-2020)
            <ul>
                <li>Merkava MK 3 Baz 4th Generation tank driver </li>
                <li>Active participant in Operation Northern Shield </li>
                <li>Responsible for maintaining the mechanical and operational capabilities of the tank</li>
                <li>Additional duties included guard shifts, patrols, arrests, weapon searches</li>
            </ul>
        </div>
        <div class="resume-section-title">
            <span style="font-weight: bold;">Work Experience</span>
        </div>
        <div class="resume-section">
            Armed Security Officer, Inbal Hotel, Jerusalem (June 2021-April 2022)
            <ul>
                <li>Responsible for the safety and security of guests and workers at 
                luxury hotel</li>
                <li>Coordinated with high-ranking government officials and diplomats with respect to high profile events and prominent guests</li>
            </ul>
        </div>
        <div class="resume-section-title">
            <span style="font-weight:bold">Languages</span>
        </div>
        <div class="resuem-section">
            <ul>
                <li>English:Mother Tounge</li>
                <li>Hebrew: Fluent</li>
            </ul>
        </div>

        <a href="Yoni Subin Resumè.docx" download><button>Download</button></a>
                
    </div>
    <div id="courses">
        <p>
            These are the courses I have completed so far:
        </p>
        <table>
            <tr>
                <td>Course number at Hebrew University</td>
                <td>Course Name</td>
                <td>Subject</td>
            </tr>
            <tr>
                <td>80114</td>
                <td>Mathematical Methods</td>
                <td>Basic mathematical material for phsyics and engeneering majors. Topics inclue vectors, complex numbers, Taylor series, functions of R<sup>n</sup> &rarr; R<sup>m</sup>, surface integrals, and integrals of multivariable functions</td>
            </tr>
            <tr>
                <td>80153</td>
                <td>Linear Algebra 1</td>
                <td>A basic introduction to linear algebra including solving large systems of equations, matrix operations, and linear transformations</td>
            </tr>
            <tr>
                <td>83312</td>
                <td>Mechanics and Special Relativity</td>
                <td>Introduction to mechanics including kinematics, circular motion, forces, and time streaching, and spacial shortening</td>
            </tr>
            <tr>
                <td>67101</td>
                <td>Intro to Computer Science</td>
                <td>Computer programming in the Python3 language. Topics include recusion, backtracking, GUI and algorithms</td>
            </tr>
            <tr>
                <td>80157</td>
                <td>Mathematical Methods 2</td>
                <td>A more in-depth look at the mathematical concepts needed for engineers. Topics include vector analysis, ordinary differential equations, power series, Forier series and complex analysis</td>
            </tr>
            <tr>
                <td>80177</td>
                <td>Infintecimal Calculus</td>
                <td>An in-depth look at the basics that serve as the foundation to mathematics. Concepts include proofs based on the 14 basic axiom of mathematics for topics such as limits, continuity, derivatives and more.</td>
            </tr>
            <tr>
                <td>80154</td>
                <td>Linear Algebra 2</td>
                <td>More advanced topics in linear algebra succh as linear operations, Euclidean spaces and Unitary spaces</td>
            </tr>
            <tr>
                <td>83313</td>
                <td>Electricity and Magnetism</td>
                <td>A gradual introduction to Electrostatics followed by Magnetostatic and finally Electrodynamics.</td>
            </tr>
        </table>
    </div>
    <div id="projects">
        <p>
            A small sampling of projects I have done:
        </p>
        <div class="project" id="sudoku">
        <p>Sudoku Solver:</p>
        <table id="sudoku-board">
            <tr>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
            </tr>
            <tr>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
            </tr>
            <tr>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
            </tr>
            
            <tr>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
            </tr>
            <tr>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
            </tr>
            <tr>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
            </tr>
            
            <tr>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
            </tr>
            <tr>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
            </tr>
            <tr>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
                <td><input type="number" class="sudoku-number"/></td>
            </tr>
        </table>
        <button id="sudoku-solve">Solve</button>
        <table id="sudoku-solution">
            <tr>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
            </tr>
            <tr>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
            </tr>
            <tr>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
            </tr>
            
            <tr>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
            </tr>
            <tr>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
            </tr>
            <tr>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
            </tr>
            
            <tr>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
            </tr>
            <tr>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
            </tr>
            <tr>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
                <td class="sudoku-sol-num"></td>
            </tr>
        </table>
        <script src="sudoku.js"></script>
        </div>
        <div class="project" id="hangman">
            <p>Hangman:</p>
            <div id="word-space">
                <h3 id="word">Hello</h3>
                <label>Guess a letter:</label>
                <input id="guess-letter"/>
                <button id="guess">Enter</button>
                <br/>
                <p id="wrong-letters-container">Guessed letters: <span id="wrong-letters"></span></p>
            </div>
            <div id="draw-space">
                <canvas id="hangman-drawing"></canvas>
            </div>
        </div>
        <script src="hangman.js"></script>
        <p>Snake Game:</p>
        <div class="project" id="snake">
            <canvas id="snake-canvas" height="500px" width="500px">
            </canvas>
            <script src="snake.js"></script>
            <button id="reset-snake">Reset</button>
        </div>
    </div>
</body>
</html>