import 'package:flutter/material.dart';
import 'package:tutoapp/pages/fourth_page.dart';
import 'package:tutoapp/pages/second_page.dart';
import 'package:tutoapp/pages/third_page.dart';

class FirstPage extends StatefulWidget {
  FirstPage({super.key});

  @override
  State<FirstPage> createState() => _FirstPageState();
}

class _FirstPageState extends State<FirstPage> {

      int _selectedIndex = 0;
    void navigateBottomBar(int index){
      setState(() {
        _selectedIndex = index;
      });
    } 
      final List _pages = [
      FourthPage(),
      SecondPage(),
      ThirdPage(),
    ];


  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text("1st page")),
      body: _pages[_selectedIndex],



    //   drawer: Drawer(
    //     child: DrawerHeader(child: Icon(Icons.favorite,size:48,)),
    //   ),
    //   body: Center(
    //     child: ElevatedButton(
    //       child: Text("go to second page "),
    //       onPressed: (){
    //         Navigator.push(context, MaterialPageRoute(
    //           builder: (context) => SecondPage(),
    //                 ),
    //         );
    //       }
    //       ),
    //   ),
    // );







         bottomNavigationBar: BottomNavigationBar(
          currentIndex: _selectedIndex,
          onTap: navigateBottomBar,
          items: [
            BottomNavigationBarItem(icon: Icon(Icons.home), label: 'Home',),
            BottomNavigationBarItem(icon: Icon(Icons.settings), label: 'settings',),
            BottomNavigationBarItem(icon: Icon(Icons.person), label: 'profile',),
          ],
         ),
        );
  }
}