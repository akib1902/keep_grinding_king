/* NAVIGATION*/

// import 'package:flutter/material.dart';
// import 'package:tutoapp/pages/fourth_page.dart';
// import 'package:tutoapp/pages/second_page.dart';
// import 'package:tutoapp/pages/third_page.dart';

// class FirstPage extends StatefulWidget {
//   FirstPage({super.key});

//   @override
//   State<FirstPage> createState() => _FirstPageState();
// }

// class _FirstPageState extends State<FirstPage> {

//       int _selectedIndex = 0;
//     void navigateBottomBar(int index){
//       setState(() {
//         _selectedIndex = index;
//       });
//     } 
//       final List _pages = [
//       FourthPage(),
//       SecondPage(),
//       ThirdPage(),
//     ];


//   @override
//   Widget build(BuildContext context) {
//     return Scaffold(
//       appBar: AppBar(title: Text("1st page")),
//       body: _pages[_selectedIndex],



//     //   drawer: Drawer(
//     //     child: DrawerHeader(child: Icon(Icons.favorite,size:48,)),
//     //   ),
//     //   body: Center(
//     //     child: ElevatedButton(
//     //       child: Text("go to second page "),
//     //       onPressed: (){
//     //         Navigator.push(context, MaterialPageRoute(
//     //           builder: (context) => SecondPage(),
//     //                 ),
//     //         );
//     //       }
//     //       ),
//     //   ),
//     // );







//          bottomNavigationBar: BottomNavigationBar(
//           currentIndex: _selectedIndex,
//           onTap: navigateBottomBar,
//           items: [
//             BottomNavigationBarItem(icon: Icon(Icons.home), label: 'Home',),
//             BottomNavigationBarItem(icon: Icon(Icons.settings), label: 'settings',),
//             BottomNavigationBarItem(icon: Icon(Icons.person), label: 'profile',),
//           ],
//          ),
//         );
//   }
// }












/* statefull widget */
// import 'package:flutter/material.dart';

// class Counterapp extends StatefulWidget {
//    Counterapp({super.key});

//   @override
//   State<Counterapp> createState() => _CounterappState();
// }

// class _CounterappState extends State<Counterapp> {
//     int _counter = 0;

//     void _incrementCounter(){
//       setState(() {
//         _counter++;
//       });
//     }

//   @override
//   Widget build(BuildContext context) {
//     return Scaffold(
//       body: Center(
//         child: Column(
//           mainAxisAlignment: MainAxisAlignment.center,
//           children: [
//             Text("you pushed the button👇this many times"),
//             Text(
//               _counter.toString(),
//               style: TextStyle(fontSize: 40),
//             ),
//             ElevatedButton(onPressed: _incrementCounter, child: Text("increment!"),),
//             ],
//         ),
//       ),
//     );
//   }
// }












//   USER INPUT
// import 'package:flutter/material.dart';
// class FirstPage extends StatefulWidget {
//   const FirstPage({super.key});

//   @override
//   State<FirstPage> createState() => _FirstPageState();
// }

// class _FirstPageState extends State<FirstPage> {
//   TextEditingController myController = TextEditingController();
//   void greetUser(){
//     setState(() {
//       greetingMessage = "how are you "+ myController.text;
//     });
//   }
//   String greetingMessage = "";
//   @override
//   Widget build(BuildContext context) {
//     return Scaffold(
//       body: Center(
//         child: Padding(
//           padding: const EdgeInsets.all(25.0),
//           child: Column(

//           mainAxisAlignment: MainAxisAlignment.center, // vertical center
//           children: [
//             Text(greetingMessage),
//             TextField(  
//               controller: myController,
//               textAlign: TextAlign.center,
//             ),
//             ElevatedButton(
//               onPressed: greetUser,
//               child: Text("tap"),
//             ),
//           ],
//           ),
//         )
//       ),
//     );
//   }
// }